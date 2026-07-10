import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ImageIcon,
  RotateCw,
  ScanLine,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import heroOutfit from "@/assets/hero-outfit.jpg";
import {
  buildRetailerLinks,
  confidenceLabel,
  makeEmptyAttributes,
  type FashionAttributes,
  type ScanHistoryItem,
  type SearchQueries,
} from "@/lib/fashion-analysis";
import {
  cropAndResizeImage,
  fileToDataUrl,
  makeThumbnail,
  type FocusCrop,
} from "@/lib/image-processing";
import {
  clearScanHistory,
  deleteScanFromHistory,
  loadScanHistory,
  saveScanToHistory,
} from "@/lib/scan-history";
import type { FashionScanItem, FashionScanResponse, FashionScanResult } from "@/lib/fashion-scan";

export const Route = createFileRoute("/")({ component: Index });

type ScannerStatus = "idle" | "ready" | "scanning" | "complete" | "error";
type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

type CropInteraction = {
  handle: CropHandle;
  startX: number;
  startY: number;
  startCrop: FocusCrop;
};

type EditableItemPatch = Partial<
  Pick<
    FashionScanItem,
    "name" | "category" | "color" | "style" | "material" | "pattern" | "visibleBrand"
  >
>;

const SCAN_STAGES = [
  "Preparing image",
  "Analyzing outfit",
  "Reviewing details",
  "Building searches",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function confidencePercent(value: number | null | undefined) {
  return Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
}

function compactQuery(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryItem(result: FashionScanResult) {
  return result.items.reduce((best, item) => (item.confidence > best.confidence ? item : best));
}

function fashionScanItemToAttributes(item: FashionScanItem): FashionAttributes {
  const confidence = confidencePercent(item.confidence);
  const isShoe = /shoe|sneaker|boot|heel|sandal|loafer/i.test(item.category);
  const isAccessory = /bag|watch|jewelry|hat|accessor|belt|scarf|sunglasses/i.test(item.category);

  return {
    ...makeEmptyAttributes(),
    category: { label: item.category, confidence },
    color: { label: item.color, confidence },
    pattern: { label: item.pattern ?? "", confidence },
    style: { label: item.style, confidence },
    material: { label: item.material ?? "", confidence },
    shoeType: { label: isShoe ? item.category : "", confidence: isShoe ? confidence : 0 },
    accessoryType: {
      label: isAccessory ? item.category : "",
      confidence: isAccessory ? confidence : 0,
    },
  };
}

function historyQueriesForItem(item: FashionScanItem): SearchQueries {
  const best = item.searchQueries[0] || compactQuery([item.color, item.name, item.category]);
  return {
    broad: best,
    balanced: item.searchQueries[1] || best,
    detailed: item.searchQueries[2] || item.searchQueries[1] || best,
  };
}

function historyItemToScanResult(scan: ScanHistoryItem): FashionScanResult {
  const attributes = scan.attributes;
  const category = attributes.category.label || scan.category || "Saved look";
  const queries = Array.from(
    new Set([scan.queries.detailed, scan.queries.balanced, scan.queries.broad].filter(Boolean)),
  );
  const fallbackQuery = compactQuery([
    attributes.color.label,
    attributes.material.label,
    attributes.style.label,
    category,
  ]);
  const searchQueries = queries.length > 0 ? queries : [fallbackQuery || category];
  const confidence =
    Math.max(
      attributes.category.confidence,
      attributes.color.confidence,
      attributes.style.confidence,
    ) / 100;

  return {
    summary: `Saved scan for ${category}.`,
    items: [
      {
        id: `saved-${scan.id}`,
        category,
        name: scan.category || category,
        color: attributes.color.label || "Color not specified",
        material: attributes.material.label || null,
        style: attributes.style.label || "Style not specified",
        pattern: attributes.pattern.label || null,
        visibleBrand: null,
        brandConfidence: 0,
        confidence,
        searchQueries,
        affordableAlternativeQueries: searchQueries,
        premiumAlternativeQueries: searchQueries,
      },
    ],
  };
}

function updateBestQuery(item: FashionScanItem, patch: EditableItemPatch): FashionScanItem {
  const next = { ...item, ...patch };
  const bestQuery = compactQuery([
    next.visibleBrand,
    next.color,
    next.material,
    next.style,
    next.name || next.category,
  ]);
  const alternateQueries = item.searchQueries.slice(1).filter((query) => query !== bestQuery);
  const brandWasEdited = Object.prototype.hasOwnProperty.call(patch, "visibleBrand");

  return {
    ...next,
    brandConfidence: brandWasEdited ? (next.visibleBrand?.trim() ? 1 : 0) : next.brandConfidence,
    searchQueries: [bestQuery || item.searchQueries[0], ...alternateQueries],
  };
}

function Index() {
  return (
    <div className="min-h-screen bg-navy text-foreground">
      <TopNav />
      <Hero />
      <Scanner />
      <Footer />
    </div>
  );
}

function TopNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all ${
        scrolled
          ? "border-b border-[rgba(201,169,106,0.15)] bg-navy/80 backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <a href="#home" className="font-serif text-xl tracking-[0.2em] text-gold">
          VEYLOR
        </a>
        <a
          href="#scanner"
          className="border-b border-gold pb-0.5 text-[11px] uppercase tracking-luxe text-gold"
        >
          Scan Outfit
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="home" className="relative overflow-hidden px-6 pb-20 pt-32 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(201,169,106,0.12),transparent_60%)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="animate-fade-up lg:col-span-6">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-luxe text-gold/80">
            <span className="h-px w-8 bg-gold/60" />
            AI Fashion Scanner
          </div>
          <h1 className="mt-8 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl lg:text-7xl">
            Upload an item.
            <br />
            <span className="gold-grad">Search the style.</span>
          </h1>
          <p className="mt-8 max-w-lg leading-relaxed text-foreground/70">
            Upload a fashion photo and let Veylor identify the visible style, colors, materials, and
            details so you can find similar looks online.
          </p>
          <a
            href="#scanner"
            className="group mt-10 inline-flex items-center gap-3 bg-gold px-7 py-3.5 text-[11px] font-medium uppercase tracking-luxe text-navy transition-colors hover:bg-[var(--gold-soft)]"
          >
            Scan an Outfit
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </a>
        </div>

        <div className="relative animate-fade-up [animation-delay:200ms] lg:col-span-6">
          <div className="relative mx-auto aspect-[4/5] max-w-md overflow-hidden">
            <img
              src={heroOutfit}
              alt="Editorial outfit with layered fashion details"
              width={1080}
              height={1350}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 ring-1 ring-gold/20" />
            <Corner className="left-3 top-3" />
            <Corner className="right-3 top-3 rotate-90" />
            <Corner className="bottom-3 left-3 -rotate-90" />
            <Corner className="bottom-3 right-3 rotate-180" />
            <div className="absolute bottom-4 left-4 border border-gold/30 bg-navy/85 px-3 py-2 backdrop-blur-sm">
              <div className="text-[9px] uppercase tracking-luxe text-gold/80">Style Analysis</div>
              <div className="mt-0.5 text-xs text-foreground">Find similar looks</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Corner({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute h-5 w-5 ${className}`}>
      <span className="absolute left-0 top-0 h-px w-full bg-gold" />
      <span className="absolute left-0 top-0 h-full w-px bg-gold" />
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-12 flex flex-col items-start gap-5">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-luxe text-gold/80">
        <span className="h-px w-8 bg-gold/60" />
        {eyebrow}
      </div>
      <h2 className="max-w-2xl font-serif text-4xl leading-tight text-foreground sm:text-5xl">
        {title}
      </h2>
    </div>
  );
}

function Scanner() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const cropInteractionRef = useRef<CropInteraction | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [stage, setStage] = useState("Choose a fashion photo");
  const [imageSrc, setImageSrc] = useState("");
  const [focusedImage, setFocusedImage] = useState("");
  const [crop, setCrop] = useState<FocusCrop>({ x: 50, y: 50, width: 58, height: 58 });
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [error, setError] = useState("");
  const [analysisWarning, setAnalysisWarning] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [scanResult, setScanResult] = useState<FashionScanResult | null>(null);

  useEffect(() => {
    setHistory(loadScanHistory());
    return () => abortRef.current?.abort();
  }, []);

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, or WebP image.");
      setStatus("error");
      return;
    }
    if (file.size > 14 * 1024 * 1024) {
      setError("This image is too large. Choose a photo under 14 MB.");
      setStatus("error");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setImageSrc(dataUrl);
      setFocusedImage("");
      setCrop({ x: 50, y: 50, width: 58, height: 58 });
      setScanResult(null);
      setStatus("ready");
      setStage("Ready to scan");
      setError("");
      setAnalysisWarning("");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "The image could not be opened.");
      setStatus("error");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  const getPointerPosition = (event: ReactPointerEvent<HTMLElement>) => {
    const frame = cropFrameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  };

  const startCropInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    handle: CropHandle = "move",
  ) => {
    if (!imageSrc || status === "scanning") return;
    const pointer = getPointerPosition(event);
    if (!pointer) return;

    event.preventDefault();
    event.stopPropagation();
    cropFrameRef.current?.setPointerCapture(event.pointerId);
    cropInteractionRef.current = {
      handle,
      startX: pointer.x,
      startY: pointer.y,
      startCrop: crop,
    };
  };

  const moveCropInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = cropInteractionRef.current;
    if (!interaction) return;
    const pointer = getPointerPosition(event);
    if (!pointer) return;

    const startHalfWidth = interaction.startCrop.width / 2;
    const startHalfHeight = interaction.startCrop.height / 2;
    const startLeft = interaction.startCrop.x - startHalfWidth;
    const startRight = interaction.startCrop.x + startHalfWidth;
    const startTop = interaction.startCrop.y - startHalfHeight;
    const startBottom = interaction.startCrop.y + startHalfHeight;
    const dx = pointer.x - interaction.startX;
    const dy = pointer.y - interaction.startY;

    if (interaction.handle === "move") {
      setCrop((current) => ({
        ...current,
        x: clamp(interaction.startCrop.x + dx, startHalfWidth, 100 - startHalfWidth),
        y: clamp(interaction.startCrop.y + dy, startHalfHeight, 100 - startHalfHeight),
      }));
      return;
    }

    const minSize = 18;
    let left = startLeft;
    let right = startRight;
    let top = startTop;
    let bottom = startBottom;

    if (interaction.handle === "nw" || interaction.handle === "sw") {
      left = clamp(startLeft + dx, 0, startRight - minSize);
    } else {
      right = clamp(startRight + dx, startLeft + minSize, 100);
    }

    if (interaction.handle === "nw" || interaction.handle === "ne") {
      top = clamp(startTop + dy, 0, startBottom - minSize);
    } else {
      bottom = clamp(startBottom + dy, startTop + minSize, 100);
    }

    const width = right - left;
    const height = bottom - top;
    setCrop({ x: left + width / 2, y: top + height / 2, width, height });
  };

  const stopCropInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    if (!cropInteractionRef.current) return;
    cropFrameRef.current?.releasePointerCapture(event.pointerId);
    cropInteractionRef.current = null;
  };

  const runScan = async () => {
    if (!imageSrc || status === "scanning") return;

    try {
      setStatus("scanning");
      setError("");
      setAnalysisWarning("");
      setStage("Preparing image");
      const cropped = await cropAndResizeImage(imageSrc, crop, 512);
      setFocusedImage(cropped);
      setScanResult(null);
      setStage("Analyzing outfit");

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/fashion-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: cropped }),
        signal: controller.signal,
      });

      setStage("Reviewing details");
      const payload = (await response.json()) as FashionScanResponse;
      abortRef.current = null;

      if ("error" in payload) {
        setStatus("error");
        setStage("Scan unavailable");
        setError(payload.error.message);
        return;
      }

      setStage("Building searches");
      const strongestItem = primaryItem(payload.result);
      setScanResult(payload.result);

      if (strongestItem.confidence < 0.35) {
        setAnalysisWarning("This scan is uncertain. Review the detected details before searching.");
      }

      setStatus("complete");
      setStage("Results ready");
    } catch (scanError) {
      abortRef.current = null;
      setStatus("error");
      setStage("Scan unavailable");
      setError(
        scanError instanceof DOMException && scanError.name === "AbortError"
          ? "The scan was cancelled."
          : scanError instanceof Error
            ? scanError.message
            : "The image could not be analyzed. Try again.",
      );
    }
  };

  const updateItem = (itemId: string, patch: EditableItemPatch) => {
    setScanResult((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === itemId ? updateBestQuery(item, patch) : item,
            ),
          }
        : current,
    );
  };

  const saveCurrentScan = async () => {
    if (!imageSrc || !scanResult) return;
    const item = primaryItem(scanResult);
    const thumbnail = await makeThumbnail(focusedImage || imageSrc);
    const historyItem: ScanHistoryItem = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      thumbnail,
      category: item.name || item.category,
      attributes: fashionScanItemToAttributes(item),
      queries: historyQueriesForItem(item),
      scannedAt: new Date().toISOString(),
    };
    setHistory(saveScanToHistory(historyItem));
    setStage("Saved to Recent Scans");
  };

  const reopenScan = (scan: ScanHistoryItem) => {
    setImageSrc(scan.thumbnail);
    setFocusedImage(scan.thumbnail);
    setCrop({ x: 50, y: 50, width: 100, height: 100 });
    setScanResult(historyItemToScanResult(scan));
    setStatus("complete");
    setStage("Saved scan opened");
    setError("");
    setAnalysisWarning("");
    window.location.hash = "scanner";
  };

  return (
    <section
      id="scanner"
      className="border-t border-[rgba(201,169,106,0.12)] bg-[var(--navy-deep)] px-6 py-24 lg:px-10 lg:py-32"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Outfit Scanner" title="Upload, scan, and search the details." />

        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div
              ref={cropFrameRef}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onPointerDown={(event) => startCropInteraction(event, "move")}
              onPointerMove={moveCropInteraction}
              onPointerUp={stopCropInteraction}
              onPointerCancel={stopCropInteraction}
              className={`relative aspect-[4/5] overflow-hidden border ${
                isDragging ? "border-gold bg-gold/10" : "border-[rgba(201,169,106,0.18)]"
              } ${imageSrc && status !== "scanning" ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
            >
              {imageSrc ? (
                <>
                  <img
                    src={imageSrc}
                    alt="Selected fashion photo preview"
                    className="h-full w-full object-cover"
                  />
                  <div
                    className="absolute border-2 border-gold bg-navy/10 shadow-[0_0_0_999px_rgba(6,13,28,0.45)]"
                    style={{
                      width: `${crop.width}%`,
                      height: `${crop.height}%`,
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div className="absolute left-3 top-3 bg-navy/85 px-2 py-1 text-[9px] uppercase tracking-luxe text-gold">
                      Drag to focus
                    </div>
                    {[
                      { handle: "nw", className: "-left-3 -top-3 cursor-nwse-resize" },
                      { handle: "ne", className: "-right-3 -top-3 cursor-nesw-resize" },
                      { handle: "sw", className: "-bottom-3 -left-3 cursor-nesw-resize" },
                      { handle: "se", className: "-bottom-3 -right-3 cursor-nwse-resize" },
                    ].map((corner) => (
                      <button
                        key={corner.handle}
                        type="button"
                        aria-label={`Resize crop ${corner.handle}`}
                        onPointerDown={(event) =>
                          startCropInteraction(event, corner.handle as CropHandle)
                        }
                        className={`absolute h-7 w-7 border border-gold bg-navy/90 ${corner.className}`}
                      >
                        <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 bg-gold" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-full w-full flex-col items-center justify-center gap-5 bg-navy p-8 text-center transition-colors hover:bg-[rgba(201,169,106,0.06)]"
                >
                  <ImageIcon className="h-12 w-12 text-gold/80" />
                  <span className="font-serif text-3xl text-foreground">Upload Photo</span>
                  <span className="max-w-xs text-sm leading-relaxed text-foreground/60">
                    Choose a clear fashion image or drag one here.
                  </span>
                </button>
              )}

              {status === "scanning" && (
                <>
                  <div className="absolute inset-0 bg-navy/35 backdrop-blur-[1px]" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="scanline animate-scan absolute inset-x-0 h-32 opacity-80" />
                  </div>
                </>
              )}

              <Corner className="left-3 top-3" />
              <Corner className="right-3 top-3 rotate-90" />
              <Corner className="bottom-3 left-3 -rotate-90" />
              <Corner className="bottom-3 right-3 rotate-180" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              aria-label="Choose a fashion photo"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {imageSrc && (
              <>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void runScan()}
                    disabled={status === "scanning"}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-gold px-5 py-3 text-[10px] uppercase tracking-luxe text-navy transition-colors hover:bg-[var(--gold-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "scanning" ? (
                      <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ScanLine className="h-3.5 w-3.5" />
                    )}
                    {status === "scanning" ? "Scanning Outfit" : "Scan Outfit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status === "scanning"}
                    className="inline-flex min-h-12 items-center justify-center gap-2 border border-gold/30 px-5 py-3 text-[10px] uppercase tracking-luxe text-foreground/75 transition-colors hover:border-gold/60 hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" /> Choose Another Photo
                  </button>
                </div>

                <div className="mt-5 border border-[rgba(201,169,106,0.16)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-foreground/55">
                      Move or resize the gold box to focus the outfit area.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCrop((current) => ({ ...current, x: 50, y: 50 }))}
                      disabled={status === "scanning"}
                      className="min-h-10 border border-[rgba(201,169,106,0.2)] px-3 py-2 text-[10px] uppercase tracking-luxe text-foreground/70 hover:border-gold/40 hover:text-gold disabled:opacity-50"
                    >
                      Center Crop
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-7">
            <div
              className="border border-[rgba(201,169,106,0.18)] bg-navy p-6 lg:p-8"
              aria-busy={status === "scanning"}
            >
              <div className="flex flex-col gap-4 border-b border-[rgba(201,169,106,0.15)] pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-luxe text-gold/80">
                    Scan Results
                  </div>
                  <p className="mt-2 text-sm text-foreground/55">
                    Review each detected item and open a similar-style search.
                  </p>
                </div>
                <div
                  className="flex items-center gap-2 text-[10px] uppercase tracking-luxe text-foreground/50"
                  aria-live="polite"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "scanning" ? "animate-pulse bg-gold" : "bg-gold/40"
                    }`}
                  />
                  {stage}
                </div>
              </div>

              {(status === "idle" || status === "ready") && !scanResult && (
                <p className="py-8 text-sm text-foreground/45">
                  Detected clothing details and searches will appear here after your scan.
                </p>
              )}

              {status === "scanning" && (
                <div className="mt-5 border border-gold/30 bg-gold/10 p-5">
                  <div className="flex items-center gap-3">
                    <RotateCw className="h-4 w-4 animate-spin text-gold" />
                    <div>
                      <div className="text-[10px] uppercase tracking-luxe text-gold">
                        Scan in progress
                      </div>
                      <p className="mt-1 text-sm text-foreground/70">{stage}</p>
                    </div>
                  </div>
                  <ScanProgress stage={stage} />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-5 flex gap-3 border border-red-400/30 bg-red-950/20 p-4 text-sm text-red-100"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p>{error}</p>
                    <p className="mt-1 text-red-100/70">
                      Try scanning again or choose a different photo.
                    </p>
                  </div>
                </div>
              )}

              {analysisWarning && (
                <div className="mt-5 flex gap-3 border border-gold/30 bg-gold/10 p-4 text-sm text-foreground/80">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                  <p>{analysisWarning}</p>
                </div>
              )}

              {scanResult && status !== "scanning" && (
                <DetectedItemsPanel
                  result={scanResult}
                  onItemChange={updateItem}
                  onSave={() => void saveCurrentScan()}
                />
              )}
            </div>

            {history.length > 0 && (
              <HistoryPanel
                history={history}
                onReopen={reopenScan}
                onDelete={(id) => setHistory(deleteScanFromHistory(id))}
                onClear={() => setHistory(clearScanHistory())}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DetectedItemsPanel({
  result,
  onItemChange,
  onSave,
}: {
  result: FashionScanResult;
  onItemChange: (itemId: string, patch: EditableItemPatch) => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-luxe text-gold/80">Detected Items</div>
          <p className="mt-2 text-sm text-foreground/60">{result.summary}</p>
        </div>
        <button
          type="button"
          onClick={onSave}
          className="inline-flex min-h-11 items-center justify-center gap-2 border border-gold/40 px-4 py-2.5 text-[10px] uppercase tracking-luxe text-foreground transition-colors hover:bg-gold hover:text-navy"
        >
          <Check className="h-3.5 w-3.5" /> Save Scan
        </button>
      </div>

      <div className="mt-5 grid gap-4">
        {result.items.map((item) => (
          <DetectedItemCard key={item.id} item={item} onChange={onItemChange} />
        ))}
      </div>
    </div>
  );
}

function DetectedItemCard({
  item,
  onChange,
}: {
  item: FashionScanItem;
  onChange: (itemId: string, patch: EditableItemPatch) => void;
}) {
  const bestQuery = item.searchQueries[0];
  const retailerLinks = buildRetailerLinks(bestQuery);
  const visibleAttributes = [
    { label: "Color", value: item.color },
    { label: "Style", value: item.style },
    { label: "Material", value: item.material },
    { label: "Pattern", value: item.pattern },
  ].filter((attribute) => Boolean(attribute.value));
  const supportedBrand = item.visibleBrand && item.brandConfidence >= 0.5;

  return (
    <article className="border border-[rgba(201,169,106,0.18)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-serif text-2xl text-foreground">{item.name}</h3>
          <p className="mt-1 text-[10px] uppercase tracking-luxe text-gold/70">{item.category}</p>
        </div>
        <span className="text-[9px] uppercase tracking-luxe text-foreground/45">
          {confidencePercent(item.confidence)}% {confidenceLabel(item.confidence)} confidence
        </span>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        {visibleAttributes.map((attribute) => (
          <div key={attribute.label}>
            <dt className="text-[9px] uppercase tracking-luxe text-foreground/35">
              {attribute.label}
            </dt>
            <dd className="mt-1 text-sm text-foreground/75">{attribute.value}</dd>
          </div>
        ))}
        {supportedBrand && (
          <div>
            <dt className="text-[9px] uppercase tracking-luxe text-foreground/35">Visible brand</dt>
            <dd className="mt-1 text-sm text-foreground/75">{item.visibleBrand}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 border-t border-[rgba(201,169,106,0.12)] pt-5">
        <div className="text-[9px] uppercase tracking-luxe text-foreground/35">Best search</div>
        <p className="mt-2 text-sm text-foreground">{bestQuery}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {retailerLinks.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 border border-[rgba(201,169,106,0.2)] px-3 py-2 text-[9px] uppercase tracking-luxe text-foreground/70 transition-colors hover:border-gold/50 hover:text-gold"
            >
              <Search className="h-3 w-3" /> {link.name}
            </a>
          ))}
        </div>

        {item.searchQueries.length > 1 && (
          <details className="mt-4 text-sm text-foreground/60">
            <summary className="cursor-pointer text-[10px] uppercase tracking-luxe text-gold/75">
              Alternate searches
            </summary>
            <ul className="mt-3 space-y-2">
              {item.searchQueries.slice(1).map((query) => (
                <li key={query}>{query}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <details className="mt-5 border-t border-[rgba(201,169,106,0.12)] pt-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-luxe text-gold">
          Edit details
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ItemField
            label="Item name"
            value={item.name}
            onChange={(value) => onChange(item.id, { name: value })}
          />
          <ItemField
            label="Category"
            value={item.category}
            onChange={(value) => onChange(item.id, { category: value })}
          />
          <ItemField
            label="Primary color"
            value={item.color}
            onChange={(value) => onChange(item.id, { color: value })}
          />
          <ItemField
            label="Style"
            value={item.style}
            onChange={(value) => onChange(item.id, { style: value })}
          />
          <ItemField
            label="Material"
            value={item.material ?? ""}
            onChange={(value) => onChange(item.id, { material: value || null })}
          />
          <ItemField
            label="Pattern"
            value={item.pattern ?? ""}
            onChange={(value) => onChange(item.id, { pattern: value || null })}
          />
          <ItemField
            label="Visible brand"
            value={item.visibleBrand ?? ""}
            hint="Only when a logo, label, or readable text supports it."
            onChange={(value) => onChange(item.id, { visibleBrand: value || null })}
          />
        </div>
      </details>
    </article>
  );
}

function ItemField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-luxe text-foreground/45">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full border border-[rgba(201,169,106,0.18)] bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
      />
      {hint && <span className="mt-1 block text-xs text-foreground/40">{hint}</span>}
    </label>
  );
}

function ScanProgress({ stage }: { stage: string }) {
  const activeIndex = Math.max(0, SCAN_STAGES.indexOf(stage));

  return (
    <div className="mt-4">
      <div className="h-1 overflow-hidden bg-foreground/10">
        <div
          className="h-full bg-gold transition-all duration-500"
          style={{ width: `${((activeIndex + 1) / SCAN_STAGES.length) * 100}%` }}
        />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {SCAN_STAGES.map((scanStage, index) => {
          const isComplete = index < activeIndex;
          const isActive = index === activeIndex;
          return (
            <div
              key={scanStage}
              className={`flex items-center gap-2 text-[9px] uppercase tracking-luxe ${
                isActive ? "text-gold" : isComplete ? "text-foreground/70" : "text-foreground/35"
              }`}
            >
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full ${
                  isActive
                    ? "bg-gold shadow-[0_0_16px_rgba(201,169,106,0.9)]"
                    : isComplete
                      ? "bg-gold/70"
                      : "bg-foreground/20"
                }`}
              />
              <span>{scanStage}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  onReopen,
  onDelete,
  onClear,
}: {
  history: ScanHistoryItem[];
  onReopen: (scan: ScanHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-8 border border-[rgba(201,169,106,0.18)] bg-navy p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-luxe text-gold/80">Recent Scans</div>
          <p className="mt-2 text-sm text-foreground/55">Saved in this browser.</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] uppercase tracking-luxe text-foreground/50 hover:text-gold"
        >
          Clear All
        </button>
      </div>

      <div className="mt-5 grid gap-px bg-[rgba(201,169,106,0.12)] sm:grid-cols-2">
        {history.map((scan) => (
          <div key={scan.id} className="flex gap-3 bg-navy p-3">
            <img
              src={scan.thumbnail}
              alt={scan.category}
              className="h-20 w-16 flex-shrink-0 bg-paper object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{scan.category}</div>
              <div className="mt-1 truncate text-xs text-foreground/45">
                {scan.queries.balanced}
              </div>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => onReopen(scan)}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-luxe text-gold"
                >
                  <RotateCw className="h-3 w-3" /> Reopen
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(scan.id)}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-luxe text-foreground/45 hover:text-gold"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[rgba(201,169,106,0.12)] px-6 py-10 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="font-serif text-sm tracking-[0.2em] text-gold">VEYLOR</div>
        <div className="text-[10px] uppercase tracking-luxe text-foreground/40">
          © {new Date().getFullYear()} Veylor · AI Fashion Scanner
        </div>
      </div>
    </footer>
  );
}
