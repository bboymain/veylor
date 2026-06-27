import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
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
  Link2,
  RotateCw,
  ScanLine,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import heroOutfit from "@/assets/hero-outfit.jpg";
import {
  buildRetailerLinks,
  buildSearchQueries,
  confidenceLabel,
  EDITABLE_ATTRIBUTE_GROUPS,
  FASHION_LABEL_GROUPS,
  getAttributeLabel,
  makeEmptyAttributes,
  type AttributeGroup,
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
import type { OllamaHealthResult } from "@/lib/ollama-fashion";

export const Route = createFileRoute("/")({ component: Index });

const NAV = [
  { id: "home", label: "Home" },
  { id: "how", label: "How It Works" },
  { id: "demo", label: "Scanner" },
  { id: "discovery", label: "Search Links" },
  { id: "model", label: "Roadmap" },
];

const SEARCH_QUERY_NOTES = [
  {
    label: "Broad",
    note: "Fast starting point for wide retailer searches.",
  },
  {
    label: "Balanced",
    note: "Adds the strongest corrected attributes.",
  },
  {
    label: "Detailed",
    note: "Best for search engines and marketplace filters.",
  },
];

type DiscoverySnapshot = {
  imageSrc: string;
  queries: SearchQueries;
  hasScanContext: boolean;
};

type ScannerStatus = "idle" | "ready" | "scanning" | "complete" | "error";

type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

type CropInteraction = {
  handle: CropHandle;
  startX: number;
  startY: number;
  startCrop: FocusCrop;
};

const SCAN_STAGES = [
  "Preparing image",
  "Connecting to AI provider",
  "Analyzing outfit",
  "Validating result",
  "Generating search terms",
];

function confidencePercent(value: number | null | undefined) {
  return Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
}

function fashionScanItemToAttributes(item: FashionScanItem): FashionAttributes {
  const confidence = confidencePercent(item.confidence);
  const isShoe = /shoe|sneaker|boot|heel|sandal|loafer/i.test(item.category);
  const isAccessory = /bag|watch|jewelry|hat|accessor|belt|scarf|sunglasses/i.test(item.category);

  return {
    ...makeEmptyAttributes(),
    category: { label: item.name || item.category, confidence },
    color: { label: item.color, confidence },
    secondaryColor: { label: "", confidence: 0 },
    pattern: { label: item.pattern ?? "", confidence },
    style: { label: item.style, confidence },
    fit: { label: "", confidence: 0 },
    silhouette: { label: "", confidence: 0 },
    sleeve: { label: "", confidence: 0 },
    neckline: { label: "", confidence: 0 },
    material: { label: item.material ?? "", confidence },
    shoeType: { label: isShoe ? item.category : "", confidence: isShoe ? confidence : 0 },
    accessoryType: {
      label: isAccessory ? item.category : "",
      confidence: isAccessory ? confidence : 0,
    },
    occasion: { label: "", confidence: 0 },
  };
}

function ollamaStatusLabel(status?: OllamaHealthResult["status"]) {
  if (status === "ollama_connected") return "Ollama connected";
  if (status === "model_not_installed") return "Model not installed";
  if (status === "invalid_ollama_response") return "Invalid Ollama response";
  if (status === "ollama_not_running") return "Ollama not running";
  return "Check local fallback";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function scanStageIndex(stage: string) {
  const index = SCAN_STAGES.indexOf(stage);
  return index === -1 ? 0 : index;
}

function Index() {
  const [discoverySnapshot, setDiscoverySnapshot] = useState<DiscoverySnapshot>({
    imageSrc: "",
    queries: { broad: "", balanced: "", detailed: "" },
    hasScanContext: false,
  });

  return (
    <div className="min-h-screen bg-navy text-foreground">
      <TopNav />
      <Hero />
      <HowItWorks />
      <Demo onDiscoveryUpdate={setDiscoverySnapshot} />
      <Discovery snapshot={discoverySnapshot} />
      <BusinessModel />
      <FinalCTA />
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
          ? "backdrop-blur-md bg-navy/80 border-b border-[rgba(201,169,106,0.15)]"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
        <a href="#home" className="font-serif text-xl tracking-[0.2em] text-gold">
          VEYLOR
        </a>
        <nav className="hidden md:flex items-center gap-10">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="text-[11px] tracking-luxe uppercase text-foreground/70 hover:text-gold transition-colors"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <a
          href="#demo"
          className="text-[11px] tracking-luxe uppercase border-b border-gold pb-0.5 text-gold"
        >
          Try Scanner
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="home" className="relative min-h-screen pt-32 pb-20 px-6 lg:px-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(201,169,106,0.12),transparent_60%)]" />
      <div className="relative mx-auto max-w-7xl grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-6 animate-fade-up">
          <div className="flex items-center gap-3 text-[10px] tracking-luxe uppercase text-gold/80">
            <span className="h-px w-8 bg-gold/60" />
            Free Local Fashion Scanner
          </div>
          <h1 className="mt-8 font-serif text-5xl sm:text-6xl lg:text-7xl leading-[1.05] text-foreground">
            Upload an item.
            <br />
            <span className="gold-grad">Search the style.</span>
          </h1>
          <p className="mt-8 max-w-md text-foreground/70 leading-relaxed">
            Veylor's MVP analyzes a fashion photo on your device, helps you correct the detected
            attributes, and builds useful retailer search phrases without paid vision or shopping
            APIs.
          </p>
          <div className="mt-10 flex items-center gap-6">
            <a
              href="#demo"
              className="group inline-flex items-center gap-3 bg-gold text-navy px-7 py-3.5 text-[11px] tracking-luxe uppercase font-medium hover:bg-[var(--gold-soft)] transition-colors"
            >
              Try the Scanner
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#how"
              className="text-[11px] tracking-luxe uppercase text-foreground/80 border-b border-foreground/30 pb-0.5 hover:border-gold hover:text-gold transition-colors"
            >
              How It Works
            </a>
          </div>
        </div>

        <div className="lg:col-span-6 relative animate-fade-up [animation-delay:200ms]">
          <div className="relative aspect-[4/5] max-w-md mx-auto overflow-hidden">
            <img
              src={heroOutfit}
              alt="Editorial fashion portrait"
              width={1080}
              height={1350}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 ring-1 ring-gold/20" />
            <Corner className="top-3 left-3" />
            <Corner className="top-3 right-3 rotate-90" />
            <Corner className="bottom-3 left-3 -rotate-90" />
            <Corner className="bottom-3 right-3 rotate-180" />
            <div className="absolute left-4 bottom-4 bg-navy/85 backdrop-blur-sm border border-gold/30 px-3 py-2">
              <div className="text-[9px] tracking-luxe uppercase text-gold/80">Local Scan</div>
              <div className="text-xs text-foreground mt-0.5">Attributes, not exact products</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Corner({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute w-5 h-5 ${className}`}>
      <span className="absolute top-0 left-0 w-full h-px bg-gold" />
      <span className="absolute top-0 left-0 h-full w-px bg-gold" />
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col items-start gap-5 mb-16">
      <div className="flex items-center gap-3 text-[10px] tracking-luxe uppercase text-gold/80">
        <span className="h-px w-8 bg-gold/60" />
        {eyebrow}
      </div>
      <h2 className="font-serif text-4xl sm:text-5xl text-foreground max-w-2xl leading-tight">
        {title}
      </h2>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      icon: Upload,
      title: "Upload",
      desc: "Choose a photo, use camera capture, or drag one in.",
    },
    {
      n: "02",
      icon: SlidersHorizontal,
      title: "Focus",
      desc: "Crop around one clothing item or accessory before analysis.",
    },
    {
      n: "03",
      icon: ScanLine,
      title: "Analyze",
      desc: "A browser-based CLIP model detects broad fashion attributes locally.",
    },
    {
      n: "04",
      icon: ShoppingBag,
      title: "Search",
      desc: "Correct the details and open normal retailer searches.",
    },
  ];
  return (
    <section id="how" className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)]">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="How It Works" title="A free prototype that stays honest." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[rgba(201,169,106,0.12)]">
          {steps.map((s) => (
            <div
              key={s.n}
              className="bg-navy p-8 lg:p-10 group hover:bg-[var(--navy-deep)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-luxe text-gold/60">{s.n}</span>
                <s.icon className="w-4 h-4 text-gold/70 group-hover:text-gold transition-colors" />
              </div>
              <h3 className="mt-10 font-serif text-2xl text-foreground">{s.title}</h3>
              <p className="mt-3 text-sm text-foreground/60 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Demo({ onDiscoveryUpdate }: { onDiscoveryUpdate: (snapshot: DiscoverySnapshot) => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const cropInteractionRef = useRef<CropInteraction | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [stage, setStage] = useState("Choose a fashion photo");
  const [imageSrc, setImageSrc] = useState("");
  const [focusedImage, setFocusedImage] = useState("");
  const [crop, setCrop] = useState<FocusCrop>({ x: 50, y: 50, width: 58, height: 58 });
  const [attributes, setAttributes] = useState<FashionAttributes>(() => makeEmptyAttributes());
  const [visibleText, setVisibleText] = useState("");
  const [possibleBrand, setPossibleBrand] = useState("");
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [error, setError] = useState("");
  const [analysisWarning, setAnalysisWarning] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthResult | null>(null);
  const [scanResult, setScanResult] = useState<FashionScanResult | null>(null);

  useEffect(() => {
    setHistory(loadScanHistory());
  }, []);

  const checkOllama = async () => {
    try {
      const response = await fetch("/api/ollama-health");
      const health = (await response.json()) as OllamaHealthResult;
      setOllamaHealth(health);
      return health;
    } catch {
      const health: OllamaHealthResult = {
        status: "ollama_not_running",
        model: "qwen2.5vl",
        message: "Ollama is not running. Start Ollama and try again.",
      };
      setOllamaHealth(health);
      return health;
    }
  };

  const queries = useMemo(
    () => buildSearchQueries(attributes, visibleText, possibleBrand),
    [attributes, possibleBrand, visibleText],
  );

  const activeQuery = queries.detailed || queries.balanced || queries.broad;
  const retailerLinks = useMemo(() => buildRetailerLinks(activeQuery), [activeQuery]);

  useEffect(() => {
    const hasScanContext =
      Boolean(imageSrc) &&
      (status === "complete" ||
        Boolean(
          attributes.category.label ||
          attributes.color.label ||
          attributes.material.label ||
          attributes.style.label ||
          visibleText ||
          possibleBrand,
        ));

    onDiscoveryUpdate({
      imageSrc: focusedImage || imageSrc,
      queries: hasScanContext ? queries : { broad: "", balanced: "", detailed: "" },
      hasScanContext,
    });
  }, [
    attributes,
    focusedImage,
    imageSrc,
    onDiscoveryUpdate,
    possibleBrand,
    queries,
    status,
    visibleText,
  ]);

  const setAttribute = (group: AttributeGroup, label: string, confidence?: number) => {
    setAttributes((current) => ({
      ...current,
      [group]: {
        label,
        confidence: confidence ?? current[group]?.confidence ?? 0,
      },
    }));
  };

  const resetScan = () => {
    setStatus("idle");
    setStage("Choose a fashion photo");
    setImageSrc("");
    setFocusedImage("");
    setCrop({ x: 50, y: 50, width: 58, height: 58 });
    setAttributes(makeEmptyAttributes());
    setVisibleText("");
    setPossibleBrand("");
    setError("");
    setAnalysisWarning("");
    setScanResult(null);
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file is not a supported image.");
      setStatus("error");
      return;
    }
    if (file.size > 14 * 1024 * 1024) {
      setError("This image is too large for the browser MVP. Try a photo under 14 MB.");
      setStatus("error");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setImageSrc(dataUrl);
      setFocusedImage("");
      setAttributes(makeEmptyAttributes());
      setVisibleText("");
      setPossibleBrand("");
      setScanResult(null);
      setStatus("ready");
      setStage("Adjust focus, then scan");
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
    cropInteractionRef.current = { handle, startX: pointer.x, startY: pointer.y, startCrop: crop };
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

    setCrop({
      x: left + width / 2,
      y: top + height / 2,
      width,
      height,
    });
  };

  const stopCropInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    if (!cropInteractionRef.current) return;
    cropFrameRef.current?.releasePointerCapture(event.pointerId);
    cropInteractionRef.current = null;
  };

  const runScan = async () => {
    if (!imageSrc) {
      fileInputRef.current?.click();
      return;
    }

    try {
      setStatus("scanning");
      setError("");
      setAnalysisWarning("");
      setStage("Preparing image");
      const cropped = await cropAndResizeImage(imageSrc, crop, 512);
      setFocusedImage(cropped);
      setScanResult(null);
      setStage("Connecting to AI provider");
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/fashion-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: cropped }),
        signal: controller.signal,
      });

      setStage("Validating result");
      const payload = (await response.json()) as FashionScanResponse;
      abortRef.current = null;

      if ("error" in payload) {
        setStatus("error");
        setStage("Manual entry available");
        setError(payload.error.message);
        return;
      }

      setStage("Generating search terms");
      const primaryItem = payload.result.items.reduce((best, item) =>
        item.confidence > best.confidence ? item : best,
      );
      const nextAttributes = fashionScanItemToAttributes(primaryItem);
      setAttributes(nextAttributes);
      setVisibleText(primaryItem.visibleBrand ?? "");
      setPossibleBrand(primaryItem.visibleBrand ?? "");
      setScanResult(payload.result);

      if (primaryItem.confidence < 0.18) {
        setAnalysisWarning(
          "The model could not confidently detect a fashion item. You can still correct details manually and use the search links.",
        );
      } else if (primaryItem.confidence < 0.35) {
        setAnalysisWarning(
          "The scan is uncertain. Review the detected details before searching retailers.",
        );
      } else {
        setAnalysisWarning("");
      }

      setStatus("complete");
      setStage("Review and correct attributes");
    } catch (scanError) {
      abortRef.current = null;
      setStatus("error");
      setStage("Manual entry available");
      setError(
        scanError instanceof DOMException && scanError.name === "AbortError"
          ? "Scan cancelled."
          : scanError instanceof Error
            ? scanError.message
            : "The scan was cancelled or failed.",
      );
    }
  };

  const cancelScan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setStage("Scan cancelled");
  };

  const saveCurrentScan = async () => {
    if (!imageSrc) return;
    const thumbnail = await makeThumbnail(focusedImage || imageSrc);
    const item: ScanHistoryItem = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      thumbnail,
      category: attributes.category.label || "Fashion item",
      attributes,
      queries,
      scannedAt: new Date().toISOString(),
    };
    setHistory(saveScanToHistory(item));
    setStage("Saved to local history");
  };

  const reopenScan = (scan: ScanHistoryItem) => {
    setImageSrc(scan.thumbnail);
    setFocusedImage(scan.thumbnail);
    setAttributes(scan.attributes);
    setStatus("complete");
    setStage("Reopened local scan");
    setError("");
    setAnalysisWarning("");
    window.location.hash = "demo";
  };

  return (
    <section
      id="demo"
      className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)] bg-[var(--navy-deep)]"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Local Scanner"
          title="Focus the item. Let local AI read the style."
        />

        <div className="grid lg:grid-cols-12 gap-10">
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
                    alt="Uploaded fashion item preview"
                    className="w-full h-full object-cover"
                  />
                  <div
                    className="absolute border-2 border-gold bg-navy/10 shadow-[0_0_0_999px_rgba(6,13,28,0.45)] transition-[box-shadow,border-color] duration-150"
                    style={{
                      width: `${crop.width}%`,
                      height: `${crop.height}%`,
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/70 bg-navy/70 backdrop-blur-sm">
                      <span className="absolute left-1/2 top-2 h-6 w-px -translate-x-1/2 bg-gold/70" />
                      <span className="absolute left-2 top-1/2 h-px w-6 -translate-y-1/2 bg-gold/70" />
                    </div>
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
                  className="w-full h-full flex flex-col items-center justify-center gap-5 p-8 text-center bg-navy hover:bg-[rgba(201,169,106,0.06)] transition-colors"
                >
                  <ImageIcon className="w-12 h-12 text-gold/80" />
                  <span className="font-serif text-3xl text-foreground">
                    Upload a fashion photo
                  </span>
                  <span className="max-w-xs text-sm text-foreground/60 leading-relaxed">
                    Your photo is prepared locally, then analyzed by the configured server-side AI
                    provider.
                  </span>
                </button>
              )}

              {status === "scanning" && (
                <>
                  <div className="absolute inset-0 bg-navy/35 backdrop-blur-[1px]" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute inset-x-0 h-32 scanline animate-scan opacity-80" />
                  </div>
                </>
              )}

              <Corner className="top-3 left-3" />
              <Corner className="top-3 right-3 rotate-90" />
              <Corner className="bottom-3 left-3 -rotate-90" />
              <Corner className="bottom-3 right-3 rotate-180" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-11 items-center gap-2 border border-gold/40 px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground hover:bg-gold hover:text-navy transition-colors"
              >
                <Upload className="w-3.5 h-3.5" /> Upload / Camera
              </button>
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={!imageSrc || status === "scanning"}
                className="inline-flex min-h-11 items-center gap-2 bg-gold px-4 py-2.5 text-[10px] tracking-luxe uppercase text-navy disabled:opacity-45 disabled:cursor-not-allowed hover:bg-[var(--gold-soft)] transition-colors"
              >
                {status === "scanning" ? (
                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanLine className="h-3.5 w-3.5" />
                )}
                {status === "scanning" ? "Scanning..." : "Scan Outfit"}
              </button>
              <button
                type="button"
                onClick={() => void checkOllama()}
                className="inline-flex min-h-11 items-center gap-2 border border-[rgba(201,169,106,0.2)] px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground/70 hover:text-gold hover:border-gold/40 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" /> {ollamaStatusLabel(ollamaHealth?.status)}
              </button>
              {status === "scanning" && (
                <button
                  type="button"
                  onClick={cancelScan}
                  className="inline-flex min-h-11 items-center gap-2 border border-red-400/30 px-4 py-2.5 text-[10px] tracking-luxe uppercase text-red-100 hover:bg-red-950/30 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
              {imageSrc && (
                <button
                  type="button"
                  onClick={resetScan}
                  className="inline-flex min-h-11 items-center gap-2 border border-[rgba(201,169,106,0.2)] px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground/70 hover:text-gold hover:border-gold/40 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>

            {imageSrc && (
              <div className="mt-6 space-y-4 border border-[rgba(201,169,106,0.16)] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[10px] tracking-luxe uppercase text-gold/80">
                      Focus Crop
                    </div>
                    <p className="mt-1 text-sm text-foreground/55">
                      Drag inside the gold box to move it. Drag any corner to resize it.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrop((current) => ({ ...current, x: 50, y: 50 }))}
                    className="inline-flex min-h-10 items-center justify-center border border-[rgba(201,169,106,0.2)] px-3 py-2 text-[10px] tracking-luxe uppercase text-foreground/70 hover:border-gold/40 hover:text-gold"
                  >
                    Center
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-7">
            <div className="border border-[rgba(201,169,106,0.18)] bg-navy p-6 lg:p-8">
              <div className="flex flex-col gap-4 border-b border-[rgba(201,169,106,0.15)] pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] tracking-luxe uppercase text-gold/80">
                    Veylor Local Analysis
                  </div>
                  <p className="mt-2 text-sm text-foreground/55">
                    The cropped image is sent through Veylor's secure server route. The default
                    provider is Gemini 2.5 Flash.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[10px] tracking-luxe uppercase text-foreground/50">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      status === "scanning" ? "bg-gold animate-pulse" : "bg-gold/40"
                    }`}
                  />
                  {stage}
                </div>
              </div>

              {ollamaHealth && (
                <div className="mt-5 border border-[rgba(201,169,106,0.18)] p-4 text-sm text-foreground/70">
                  <span className="text-[10px] tracking-luxe uppercase text-gold/70">
                    {ollamaStatusLabel(ollamaHealth.status)}
                  </span>
                  <p className="mt-1">{ollamaHealth.message}</p>
                </div>
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
                <div className="mt-5 flex gap-3 border border-red-400/30 bg-red-950/20 p-4 text-sm text-red-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p>{error}</p>
                    <p className="mt-1 text-red-100/70">
                      You can still enter details manually and generate search links.
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

              {scanResult && <DetectedItemsPanel result={scanResult} />}

              <div className="mt-6 grid sm:grid-cols-3 gap-px bg-[rgba(201,169,106,0.12)]">
                {[
                  { k: "Model", v: "Gemini 2.5 Flash" },
                  { k: "Processing", v: "Server route" },
                  { k: "Products", v: "Search terms only" },
                ].map((b) => (
                  <div key={b.k} className="bg-navy p-4">
                    <div className="text-[9px] tracking-luxe uppercase text-foreground/40">
                      {b.k}
                    </div>
                    <div className="mt-2 text-sm text-foreground">{b.v}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid md:grid-cols-2 gap-px bg-[rgba(201,169,106,0.12)]">
                {EDITABLE_ATTRIBUTE_GROUPS.map((group) => (
                  <AttributeEditor
                    key={group}
                    group={group}
                    value={attributes[group]?.label ?? ""}
                    confidence={attributes[group]?.confidence ?? 0}
                    onChange={(value) => setAttribute(group, value)}
                  />
                ))}
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[10px] tracking-luxe uppercase text-gold/70">
                    Visible Text
                  </span>
                  <input
                    value={visibleText}
                    onChange={(event) => setVisibleText(event.target.value)}
                    placeholder="Optional logo or printed text"
                    className="mt-2 w-full border border-[rgba(201,169,106,0.18)] bg-transparent px-3 py-3 text-sm outline-none focus:border-gold"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] tracking-luxe uppercase text-gold/70">
                    Possible Brand
                  </span>
                  <input
                    value={possibleBrand}
                    onChange={(event) => setPossibleBrand(event.target.value)}
                    placeholder="Only when text/logo supports it"
                    className="mt-2 w-full border border-[rgba(201,169,106,0.18)] bg-transparent px-3 py-3 text-sm outline-none focus:border-gold"
                  />
                </label>
              </div>

              <QueryPanel
                queries={queries}
                retailerLinks={retailerLinks}
                onSave={() => void saveCurrentScan()}
              />
            </div>

            <HistoryPanel
              history={history}
              onReopen={reopenScan}
              onDelete={(id) => setHistory(deleteScanFromHistory(id))}
              onClear={() => setHistory(clearScanHistory())}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function DetectedItemsPanel({ result }: { result: FashionScanResult }) {
  return (
    <div className="mt-5 border border-[rgba(201,169,106,0.18)] p-5">
      <div className="text-[10px] uppercase tracking-luxe text-gold/80">Detected Items</div>
      <p className="mt-2 text-sm text-foreground/60">{result.summary}</p>
      <div className="mt-4 grid gap-px bg-[rgba(201,169,106,0.12)]">
        {result.items.map((item) => (
          <div key={item.id} className="bg-navy p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-foreground">{item.name}</div>
                <div className="mt-1 text-xs text-foreground/50">
                  {[item.color, item.material, item.style, item.pattern]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              </div>
              <div className="text-[9px] uppercase text-gold/70">
                {confidencePercent(item.confidence)}% {confidenceLabel(item.confidence)}
              </div>
            </div>
            {item.visibleBrand && (
              <div className="mt-3 text-xs text-foreground/60">
                Visible brand: {item.visibleBrand} ({confidencePercent(item.brandConfidence)}%)
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {item.searchQueries.slice(0, 3).map((query) => (
                <span
                  key={query}
                  className="border border-[rgba(201,169,106,0.18)] px-2 py-1 text-[10px] text-foreground/55"
                >
                  {query}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanProgress({ stage, compact = false }: { stage: string; compact?: boolean }) {
  const activeIndex = scanStageIndex(stage);

  return (
    <div className={compact ? "mt-5" : "mt-4"}>
      <div className="h-1 overflow-hidden bg-foreground/10">
        <div
          className="h-full bg-gold transition-all duration-500"
          style={{ width: `${((activeIndex + 1) / SCAN_STAGES.length) * 100}%` }}
        />
      </div>
      <div className={compact ? "mt-4 grid gap-2" : "mt-4 grid gap-2 sm:grid-cols-5"}>
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

function AttributeEditor({
  group,
  value,
  confidence,
  onChange,
}: {
  group: AttributeGroup;
  value: string;
  confidence: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="bg-navy p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="text-[9px] tracking-luxe uppercase text-foreground/40">
          {getAttributeLabel(group)}
        </span>
        {confidence > 0 && (
          <span className="text-[9px] uppercase text-gold/70">
            {confidence}% {confidenceLabel(confidence / 100)}
          </span>
        )}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full min-h-10 bg-transparent text-sm text-foreground outline-none"
      >
        <option value="">Choose manually</option>
        {FASHION_LABEL_GROUPS[group].map((label) => (
          <option key={label} value={label} className="bg-navy text-foreground">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function QueryPanel({
  queries,
  retailerLinks,
  onSave,
}: {
  queries: SearchQueries;
  retailerLinks: ReturnType<typeof buildRetailerLinks>;
  onSave: () => void;
}) {
  return (
    <div className="mt-8 border-t border-[rgba(201,169,106,0.15)] pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] tracking-luxe uppercase text-gold/80">Generated Queries</div>
          <p className="mt-2 text-sm text-foreground/55">
            These are external searches, not verified Veylor product matches.
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          className="inline-flex min-h-11 items-center justify-center gap-2 border border-gold/40 px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground hover:bg-gold hover:text-navy transition-colors"
        >
          <Check className="h-3.5 w-3.5" /> Save Scan
        </button>
      </div>

      <div className="mt-5 grid gap-px bg-[rgba(201,169,106,0.12)]">
        {Object.entries(queries).map(([kind, query]) => (
          <div key={kind} className="bg-navy p-4">
            <div className="text-[9px] tracking-luxe uppercase text-foreground/40">{kind}</div>
            <div className="mt-1 text-sm text-foreground">
              {query || "Add attributes to build a query"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {retailerLinks.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 border border-[rgba(201,169,106,0.2)] px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground/75 hover:text-gold hover:border-gold/50 transition-colors"
          >
            <Search className="h-3.5 w-3.5" /> {link.name}
          </a>
        ))}
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
          <div className="text-[10px] tracking-luxe uppercase text-gold/80">Local Scan History</div>
          <p className="mt-2 text-sm text-foreground/55">
            Small thumbnails and search terms stay in this browser.
          </p>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] tracking-luxe uppercase text-foreground/50 hover:text-gold"
          >
            Clear All
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="mt-5 text-sm text-foreground/45">No saved scans yet.</div>
      ) : (
        <div className="mt-5 grid sm:grid-cols-2 gap-px bg-[rgba(201,169,106,0.12)]">
          {history.map((scan) => (
            <div key={scan.id} className="bg-navy p-3 flex gap-3">
              <img
                src={scan.thumbnail}
                alt={scan.category}
                className="h-20 w-16 flex-shrink-0 object-cover bg-paper"
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
                    className="inline-flex items-center gap-1 text-[10px] tracking-luxe uppercase text-gold"
                  >
                    <RotateCw className="h-3 w-3" /> Reopen
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(scan.id)}
                    className="inline-flex items-center gap-1 text-[10px] tracking-luxe uppercase text-foreground/45 hover:text-gold"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Discovery({ snapshot }: { snapshot: DiscoverySnapshot }) {
  const queryCards = SEARCH_QUERY_NOTES.map((item) => ({
    ...item,
    query: snapshot.queries[item.label.toLowerCase() as keyof SearchQueries],
  }));

  return (
    <section
      id="discovery"
      className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)]"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Search Links"
          title="Useful phrases instead of fabricated matches."
        />

        <div className="grid lg:grid-cols-3 gap-px bg-[rgba(201,169,106,0.12)]">
          {queryCards.map((example, i) => (
            <div key={example.label} className="bg-navy p-8 lg:p-10">
              <div className="flex items-center gap-2 text-[10px] tracking-luxe uppercase text-gold/80">
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span className="h-px w-6 bg-gold/40" />
                <span>{example.label}</span>
              </div>
              <p className="mt-3 text-sm text-foreground/55">{example.note}</p>
              <div className="mt-8 aspect-[4/5] overflow-hidden bg-[rgba(201,169,106,0.08)]">
                {snapshot.imageSrc ? (
                  <img
                    src={snapshot.imageSrc}
                    alt="Current uploaded fashion item"
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-sm leading-relaxed text-foreground/45">
                    Upload and scan one fashion item to generate related search phrases here.
                  </div>
                )}
              </div>
              <div className="mt-4 min-h-10 text-sm text-foreground">
                {example.query || "Waiting for your scan"}
              </div>
              {example.query && snapshot.hasScanContext ? (
                <a
                  href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(example.query)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-[10px] tracking-luxe uppercase text-foreground/60 hover:text-gold border-b border-foreground/20 hover:border-gold pb-0.5"
                >
                  Search this phrase <Link2 className="h-3 w-3" />
                </a>
              ) : (
                <span className="mt-3 inline-flex items-center gap-2 text-[10px] tracking-luxe uppercase text-foreground/35 border-b border-foreground/10 pb-0.5">
                  Search after scan <Link2 className="h-3 w-3" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessModel() {
  const pillars = [
    { t: "Free MVP", d: "General fashion attributes and retailer-ready search phrases." },
    {
      t: "Verified Commerce",
      d: "Later integrations could add product IDs and live prices.",
    },
    {
      t: "Retail Coverage",
      d: "Future APIs could compare availability without scraping retailers.",
    },
    { t: "Saved Looks", d: "Local history today; optional account sync later." },
  ];
  const markets = [
    "Budget-conscious users looking for similar styles without needing exact item IDs.",
    "Fashion-focused users who want a quick vocabulary for searching clothing and accessories.",
  ];
  return (
    <section
      id="model"
      className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)] bg-[var(--navy-deep)]"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Roadmap" title="Start free, add verified commerce later." />

        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="text-[10px] tracking-luxe uppercase text-gold/70 mb-6">
              Honest limits
            </div>
            <ul className="space-y-5">
              {markets.map((m) => (
                <li key={m} className="flex gap-4">
                  <Check className="w-4 h-4 text-gold mt-1 flex-shrink-0" />
                  <span className="text-foreground/80 leading-relaxed">{m}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <div className="grid sm:grid-cols-2 gap-px bg-[rgba(201,169,106,0.12)]">
              {pillars.map((p, i) => (
                <div key={p.t} className="bg-navy p-8">
                  <div className="text-[10px] tracking-luxe text-gold/60">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-4 font-serif text-2xl text-foreground">{p.t}</div>
                  <div className="mt-2 text-sm text-foreground/55 leading-relaxed">{p.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-40 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)] text-center">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-serif text-5xl sm:text-6xl lg:text-7xl leading-[1.05]">
          Scan locally. <span className="gold-grad">Search smarter.</span>
        </h2>
        <a
          href="#demo"
          className="mt-12 inline-flex items-center gap-3 bg-gold text-navy px-8 py-4 text-[11px] tracking-luxe uppercase font-medium hover:bg-[var(--gold-soft)] transition-colors"
        >
          Start with an Image <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[rgba(201,169,106,0.12)] py-10 px-6 lg:px-10">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="font-serif text-sm tracking-[0.2em] text-gold">VEYLOR</div>
        <div className="text-[10px] tracking-luxe uppercase text-foreground/40">
          © {new Date().getFullYear()} Veylor · Free local fashion scanner MVP
        </div>
      </div>
    </footer>
  );
}
