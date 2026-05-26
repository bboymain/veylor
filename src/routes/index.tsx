import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Upload, Link2, ScanLine, Sparkles, ShoppingBag, ArrowRight, Check } from "lucide-react";
import heroOutfit from "@/assets/hero-outfit.jpg";
import itemJacket from "@/assets/item-jacket.jpg";
import itemTop from "@/assets/item-top.jpg";
import itemPants from "@/assets/item-pants.jpg";
import itemShoes from "@/assets/item-shoes.jpg";
import itemWatch from "@/assets/item-watch.jpg";

export const Route = createFileRoute("/")({ component: Index });

const NAV = [
  { id: "home", label: "Home" },
  { id: "how", label: "How It Works" },
  { id: "demo", label: "Demo" },
  { id: "discovery", label: "Product Discovery" },
  { id: "model", label: "Business Model" },
];

const DETECTED = [
  { id: "jacket", type: "Outerwear", desc: "Oversized wool overcoat, charcoal", brand: "The Row · Darryl", confidence: 96, img: itemJacket },
  { id: "top", type: "Knitwear", desc: "Ribbed cashmere turtleneck, cream", brand: "Loro Piana · Dolcevita", confidence: 92, img: itemTop },
  { id: "pants", type: "Trousers", desc: "Tapered pleated wool, black", brand: "Lemaire · Carrot", confidence: 89, img: itemPants },
  { id: "shoes", type: "Footwear", desc: "Polished leather chelsea boot", brand: "Bottega Veneta", confidence: 94, img: itemShoes },
  { id: "watch", type: "Accessory", desc: "Slim gold dress watch, leather strap", brand: "Cartier · Tank", confidence: 87, img: itemWatch },
];

const TIERS = [
  {
    label: "Authentic Luxury",
    sub: "The original or its closest peer",
    items: [
      { name: "Darryl Wool Overcoat", store: "The Row", price: "$4,290" },
      { name: "Dolcevita Cashmere", store: "Loro Piana", price: "$1,795" },
      { name: "Carrot Wool Trouser", store: "Lemaire", price: "$760" },
    ],
  },
  {
    label: "Premium Alternative",
    sub: "Same language, accessible house",
    items: [
      { name: "Drape Wool Coat", store: "Toteme", price: "$1,290" },
      { name: "Rib Cashmere Turtleneck", store: "COS Atelier", price: "$295" },
      { name: "Pleat Wool Trouser", store: "Studio Nicholson", price: "$420" },
    ],
  },
  {
    label: "Affordable Recreation",
    sub: "The aesthetic, within reach",
    items: [
      { name: "Oversized Wool-Blend Coat", store: "Arket", price: "$329" },
      { name: "Merino Turtleneck", store: "Uniqlo +J", price: "$79" },
      { name: "Tailored Pleat Trouser", store: "Mango", price: "$119" },
    ],
  },
];

function Index() {
  return (
    <div className="min-h-screen bg-navy text-foreground">
      <TopNav />
      <Hero />
      <HowItWorks />
      <Demo />
      <Discovery />
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
        scrolled ? "backdrop-blur-md bg-navy/80 border-b border-[rgba(201,169,106,0.15)]" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
        <a href="#home" className="font-serif text-xl tracking-[0.2em] text-gold">VEYLOR</a>
        <nav className="hidden md:flex items-center gap-10">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className="text-[11px] tracking-luxe uppercase text-foreground/70 hover:text-gold transition-colors">
              {n.label}
            </a>
          ))}
        </nav>
        <a href="#demo" className="text-[11px] tracking-luxe uppercase border-b border-gold pb-0.5 text-gold">
          Try Demo
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
            The Shazam of Fashion
          </div>
          <h1 className="mt-8 font-serif text-5xl sm:text-6xl lg:text-7xl leading-[1.05] text-foreground">
            Upload any outfit.
            <br />
            <span className="gold-grad">Discover the look.</span>
          </h1>
          <p className="mt-8 max-w-md text-foreground/70 leading-relaxed">
            Veylor identifies fashion pieces and locates exact or comparable options across luxury, premium, and affordable tiers.
          </p>
          <div className="mt-10 flex items-center gap-6">
            <a href="#demo" className="group inline-flex items-center gap-3 bg-gold text-navy px-7 py-3.5 text-[11px] tracking-luxe uppercase font-medium hover:bg-[var(--gold-soft)] transition-colors">
              Try the Demo <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#how" className="text-[11px] tracking-luxe uppercase text-foreground/80 border-b border-foreground/30 pb-0.5 hover:border-gold hover:text-gold transition-colors">
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
            {/* corner marks */}
            <Corner className="top-3 left-3" />
            <Corner className="top-3 right-3 rotate-90" />
            <Corner className="bottom-3 left-3 -rotate-90" />
            <Corner className="bottom-3 right-3 rotate-180" />
            {/* tag overlay */}
            <div className="absolute left-4 bottom-4 bg-navy/85 backdrop-blur-sm border border-gold/30 px-3 py-2">
              <div className="text-[9px] tracking-luxe uppercase text-gold/80">Identified</div>
              <div className="text-xs text-foreground mt-0.5">5 items · 92% avg.</div>
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
      <h2 className="font-serif text-4xl sm:text-5xl text-foreground max-w-2xl leading-tight">{title}</h2>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", icon: Upload, title: "Upload", desc: "Drop an image or paste a link." },
    { n: "02", icon: ScanLine, title: "Identify", desc: "AI reads garments, accessories, silhouette." },
    { n: "03", icon: Sparkles, title: "Analyze", desc: "Color palette, material, fashion aesthetic." },
    { n: "04", icon: ShoppingBag, title: "Discover", desc: "Real products across three pricing tiers." },
  ];
  return (
    <section id="how" className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)]">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="How It Works" title="From a single image to the entire look." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[rgba(201,169,106,0.12)]">
          {steps.map((s) => (
            <div key={s.n} className="bg-navy p-8 lg:p-10 group hover:bg-[var(--navy-deep)] transition-colors">
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

function Demo() {
  const [stage, setStage] = useState<"upload" | "scanning" | "results">("upload");

  const run = () => {
    setStage("scanning");
    setTimeout(() => setStage("results"), 2400);
  };

  return (
    <section id="demo" className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)] bg-[var(--navy-deep)]">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Interactive Demo" title="See Veylor read an outfit." />

        <div className="grid lg:grid-cols-12 gap-10">
          {/* Left: image / upload */}
          <div className="lg:col-span-6">
            <div className="relative aspect-[4/5] max-w-lg overflow-hidden border border-[rgba(201,169,106,0.18)]">
              <img
                src={heroOutfit}
                alt="Outfit being analyzed"
                loading="lazy"
                width={1080}
                height={1350}
                className="w-full h-full object-cover"
              />
              {stage === "scanning" && (
                <>
                  <div className="absolute inset-0 bg-navy/30" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute inset-x-0 h-32 scanline animate-scan opacity-70" />
                  </div>
                  <div className="absolute bottom-4 left-4 text-[10px] tracking-luxe uppercase text-gold animate-pulse">
                    Analyzing silhouette…
                  </div>
                </>
              )}
              {stage === "results" && (
                <div className="absolute inset-0 pointer-events-none">
                  {[
                    { top: "18%", left: "55%", label: "Knit" },
                    { top: "35%", left: "48%", label: "Coat" },
                    { top: "70%", left: "50%", label: "Trouser" },
                    { top: "92%", left: "52%", label: "Boot" },
                  ].map((m) => (
                    <div key={m.label} style={{ top: m.top, left: m.left }} className="absolute -translate-x-1/2 -translate-y-1/2">
                      <span className="block w-2.5 h-2.5 rounded-full bg-gold ring-4 ring-gold/20" />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] tracking-luxe uppercase text-gold whitespace-nowrap bg-navy/80 px-2 py-0.5">
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Corner className="top-3 left-3" />
              <Corner className="top-3 right-3 rotate-90" />
              <Corner className="bottom-3 left-3 -rotate-90" />
              <Corner className="bottom-3 right-3 rotate-180" />
            </div>

            <div className="mt-6 flex flex-wrap gap-3 max-w-lg">
              <button onClick={run} className="inline-flex items-center gap-2 border border-gold/40 px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground hover:bg-gold hover:text-navy transition-colors">
                <Upload className="w-3.5 h-3.5" /> Upload Image
              </button>
              <button onClick={run} className="inline-flex items-center gap-2 border border-[rgba(201,169,106,0.2)] px-4 py-2.5 text-[10px] tracking-luxe uppercase text-foreground/70 hover:text-gold hover:border-gold/40 transition-colors">
                <Link2 className="w-3.5 h-3.5" /> Paste Link
              </button>
            </div>
          </div>

          {/* Right: AI panel */}
          <div className="lg:col-span-6">
            <div className="border border-[rgba(201,169,106,0.18)] bg-navy p-8">
              <div className="flex items-center justify-between border-b border-[rgba(201,169,106,0.15)] pb-4">
                <div className="text-[10px] tracking-luxe uppercase text-gold/80">Veylor AI · Analysis</div>
                <div className="flex items-center gap-2 text-[10px] tracking-luxe uppercase text-foreground/50">
                  <span className={`w-1.5 h-1.5 rounded-full ${stage === "scanning" ? "bg-gold animate-pulse" : "bg-gold/40"}`} />
                  {stage === "upload" && "Idle"}
                  {stage === "scanning" && "Scanning"}
                  {stage === "results" && "Complete"}
                </div>
              </div>

              {/* Aesthetic block */}
              <div className="grid grid-cols-3 gap-px bg-[rgba(201,169,106,0.12)] mt-6">
                {[
                  { k: "Aesthetic", v: "Minimal Luxury" },
                  { k: "Silhouette", v: "Oversized · Long" },
                  { k: "Palette", v: "Charcoal · Cream" },
                ].map((b) => (
                  <div key={b.k} className="bg-navy p-4">
                    <div className="text-[9px] tracking-luxe uppercase text-foreground/40">{b.k}</div>
                    <div className="mt-2 text-sm text-foreground">{b.v}</div>
                  </div>
                ))}
              </div>

              {/* Detected items list */}
              <div className="mt-6 space-y-px bg-[rgba(201,169,106,0.12)]">
                {DETECTED.map((d, i) => (
                  <div key={d.id} className="bg-navy flex items-center gap-4 p-4">
                    <img src={d.img} alt={d.type} loading="lazy" width={80} height={100} className="w-12 h-14 object-cover bg-paper" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-[10px] tracking-luxe uppercase text-gold/80">{d.type}</div>
                        <div className="text-[10px] tracking-luxe text-foreground/40">{stage === "results" ? `${d.confidence}%` : "—"}</div>
                      </div>
                      <div className="mt-1 text-sm text-foreground truncate">{d.desc}</div>
                      <div className="text-[11px] text-foreground/50">{d.brand}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Discovery() {
  return (
    <section id="discovery" className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)]">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Product Discovery" title="The same look, across every budget." />

        <div className="grid lg:grid-cols-3 gap-px bg-[rgba(201,169,106,0.12)]">
          {TIERS.map((tier, i) => (
            <div key={tier.label} className="bg-navy p-8 lg:p-10">
              <div className="flex items-center gap-2 text-[10px] tracking-luxe uppercase text-gold/80">
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span className="h-px w-6 bg-gold/40" />
                <span>{tier.label}</span>
              </div>
              <p className="mt-3 text-sm text-foreground/55">{tier.sub}</p>

              <div className="mt-8 space-y-6">
                {tier.items.map((it, idx) => {
                  const img = [itemJacket, itemTop, itemPants][idx];
                  return (
                    <div key={it.name} className="group">
                      <div className="aspect-[4/5] overflow-hidden bg-paper">
                        <img src={img} alt={it.name} loading="lazy" width={800} height={1000} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-foreground truncate">{it.name}</div>
                          <div className="text-[11px] text-foreground/45 tracking-wide">{it.store}</div>
                        </div>
                        <div className="text-sm text-gold whitespace-nowrap">{it.price}</div>
                      </div>
                      <a href="#" className="mt-2 inline-block text-[10px] tracking-luxe uppercase text-foreground/60 hover:text-gold border-b border-foreground/20 hover:border-gold pb-0.5">
                        View Item
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessModel() {
  const pillars = [
    { t: "Affiliate", d: "Commission on every routed purchase." },
    { t: "Subscription", d: "Veylor Premium for unlimited scans + saved looks." },
    { t: "Brand Advertising", d: "Sponsored placements within tiers." },
    { t: "Trend Intelligence", d: "Aggregated demand signals licensed to brands." },
  ];
  const markets = [
    "Budget-conscious users seeking luxury-inspired aesthetics.",
    "Fashion-focused users wanting exact celebrity / runway identification.",
  ];
  return (
    <section id="model" className="py-32 px-6 lg:px-10 border-t border-[rgba(201,169,106,0.12)] bg-[var(--navy-deep)]">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Business Model" title="A platform built on aesthetic intelligence." />

        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="text-[10px] tracking-luxe uppercase text-gold/70 mb-6">Market</div>
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
                  <div className="text-[10px] tracking-luxe text-gold/60">{String(i + 1).padStart(2, "0")}</div>
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
          Discover fashion <span className="gold-grad">instantly.</span>
        </h2>
        <a href="#demo" className="mt-12 inline-flex items-center gap-3 bg-gold text-navy px-8 py-4 text-[11px] tracking-luxe uppercase font-medium hover:bg-[var(--gold-soft)] transition-colors">
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
          © {new Date().getFullYear()} Veylor · The Shazam of Fashion
        </div>
      </div>
    </footer>
  );
}
