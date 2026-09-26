import { useCallback, useEffect, useRef, useState } from "react";
import { removeBackground } from "@imgly/background-removal";
import {
  ArrowDownToLine,
  ArrowUpLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  ImagePlus,
  Layers3,
  Loader2,
  LockKeyhole,
  Menu,
  RefreshCw,
  Sparkles,
  Zap,
  WandSparkles,
  X,
} from "lucide-react";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

type BgMode = "transparent" | "white" | "warm";
type ProcessingStage = "idle" | "analyzing" | "refining" | "ready";

const resizeForPreview = async (imageFile: File, maxSide = 960): Promise<Blob> => {
  const bitmap = await createImageBitmap(imageFile);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Preview unavailable")), "image/jpeg", 0.86));
};

type RemovalConfig = Parameters<typeof removeBackground>[1];
const removeWithLocalAcceleration = async (image: Blob, config: RemovalConfig) => {
  try {
    return await removeBackground(image, { ...config, device: "gpu" });
  } catch (gpuError) {
    console.info("WebGPU unavailable; using local CPU fallback.", gpuError);
    return removeBackground(image, { ...config, device: "cpu" });
  }
};

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, [sourceUrl, resultUrl]);

  const pickFile = useCallback((nextFile?: File) => {
    if (!nextFile) return;
    if (!ACCEPTED.includes(nextFile.type)) {
      setError("ارفع صورة بصيغة PNG أو JPG أو WEBP فقط.");
      return;
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      setError("حجم الصورة كبير. الحد الأقصى 20 ميجابايت.");
      return;
    }
    setError("");
    setFile(nextFile);
    setSourceUrl(URL.createObjectURL(nextFile));
    setResultUrl("");
    setResultBlob(null);
    setProgress(0);
  }, []);

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    pickFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const processImage = async () => {
    if (!file) return;
    setProcessing(true);
    setError("");
    setProgress(3);
    setStage("analyzing");
    setPhase("تحليل سريع للصورة");
    let previewReady = false;
    try {
      // المرحلة الأولى: نموذج كمّي صغير + نسخة مصغّرة = نتيجة أولية أسرع بكثير.
      const previewBlob = await removeWithLocalAcceleration(await resizeForPreview(file), {
        model: "isnet_quint8",
        output: { format: "image/png", quality: 0.86 },
        progress: (_key, current, total) => {
          if (total) setProgress(Math.max(8, Math.min(48, Math.round((current / total) * 48))));
        },
      });
      setResultBlob(previewBlob);
      setResultUrl(URL.createObjectURL(previewBlob));
      previewReady = true;
      setStage("refining");
      setPhase("تنقية الحواف والتفاصيل");
      setProgress(55);

      // المرحلة الثانية: نحدد سقفاً ذكياً للدقة كي لا تتأخر الصور الكبيرة.
      const refinedInput = await resizeForPreview(file, 1800);
      const refinedBlob = await removeWithLocalAcceleration(refinedInput, {
        model: "isnet_fp16",
        output: { format: "image/png", quality: 1 },
        progress: (_key, current, total) => {
          if (total) setProgress(Math.max(56, Math.min(98, 56 + Math.round((current / total) * 42))));
        },
      });
      setResultBlob(refinedBlob);
      setResultUrl(URL.createObjectURL(refinedBlob));
      setStage("ready");
      setPhase("اكتملت النتيجة بدقة عالية");
      setProgress(100);
    } catch (err) {
      console.error(err);
      // إذا فشل التحسين، لا نخسر المعاينة السريعة التي ظهرت للمستخدم.
      if (previewReady) {
        setStage("ready");
        setPhase("تم عرض المعاينة السريعة");
        setError("اكتملت المعاينة السريعة، لكن تعذر تحسين الدقة. يمكنك تنزيلها أو إعادة المحاولة.");
      } else {
        setStage("idle");
        setError("تعذر معالجة الصورة الآن. جرّب صورة أخرى أو أعد المحاولة.");
      }
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setSourceUrl("");
    setResultUrl("");
    setResultBlob(null);
    setError("");
    setProgress(0);
    setStage("idle");
    setPhase("");
  };

  const download = async () => {
    if (!resultBlob || !resultUrl) return;
    let downloadUrl = resultUrl;
    if (bgMode !== "transparent") {
      const image = new Image();
      image.src = resultUrl;
      await new Promise((resolve) => (image.onload = resolve));
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = bgMode === "white" ? "#ffffff" : "#f7eee4";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      downloadUrl = canvas.toDataURL("image/jpeg", 0.94);
    }
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `shafaf-${file?.name.replace(/\.[^/.]+$/, "") || "image"}.${bgMode === "transparent" ? "png" : "jpg"}`;
    link.click();
  };

  const hasResult = Boolean(resultUrl);

  return (
    <div dir="rtl" className="app-shell">
      <header className="topbar">
        <div className="nav-wrap">
          <a className="brand" href="#top" aria-label="شفّاف">
            <span className="brand-mark"><Sparkles size={16} strokeWidth={2.5} /></span>
            <span>شفّاف</span>
          </a>
          <nav className="desktop-nav">
            <a href="#how">كيف يعمل</a>
            <a href="#features">المميزات</a>
            <a href="#privacy">الخصوصية</a>
          </nav>
          <div className="nav-actions">
            <button className="ghost-button desktop-only" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>تعرّف أكثر</button>
            <button className="primary-button compact desktop-only" onClick={() => inputRef.current?.click()}>ابدأ الآن <ArrowUpLeft size={16} /></button>
            <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="فتح القائمة"><Menu size={20} /></button>
          </div>
        </div>
        {menuOpen && <div className="mobile-menu"><a href="#how" onClick={() => setMenuOpen(false)}>كيف يعمل</a><a href="#features" onClick={() => setMenuOpen(false)}>المميزات</a><a href="#privacy" onClick={() => setMenuOpen(false)}>الخصوصية</a></div>}
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-glow glow-one" /><div className="hero-glow glow-two" />
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> مدعوم بالذكاء الاصطناعي</div>
            <h1>خلفية؟ <em>اختفت.</em></h1>
            <p className="hero-subtitle">حوّل أي صورة إلى صورة بخلفية شفافة خلال ثوانٍ.<br />دقة نظيفة، حواف طبيعية، وبدون تعقيد.</p>
          </div>

          <div className={`upload-card ${dragging ? "is-dragging" : ""} ${hasResult ? "has-result" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); pickFile(event.dataTransfer.files[0]); }}>
            <input className="file-input" ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleInput} aria-label="اختر صورة" />
            {!file ? (
              <button className="drop-zone" onClick={() => inputRef.current?.click()}>
                <span className="upload-icon"><ImagePlus size={28} /></span>
                <span className="drop-title">اسحب الصورة هنا</span>
                <span className="drop-or">أو</span>
                <span className="browse-button">اختر من جهازك <ArrowUpLeft size={15} /></span>
                <span className="file-hint">PNG أو JPG أو WEBP · حتى 20MB</span>
              </button>
            ) : (
              <div className="workspace">
                <div className="workspace-toolbar">
                  <div className="file-chip"><span className="file-dot" /><span>{file.name}</span><span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
                  <button className="icon-button" onClick={reset} aria-label="إزالة الصورة"><X size={17} /></button>
                </div>
                <div className="preview-grid">
                  <div className="preview-panel"><span className="panel-label">الأصل</span><img src={sourceUrl} alt="الصورة الأصلية" /></div>
                  <div className={`preview-panel result-panel ${hasResult ? "ready" : ""}`}><span className="panel-label">النتيجة الذكية</span>{hasResult ? <div className="checker"><img src={resultUrl} alt="الصورة بعد إزالة الخلفية" /></div> : <div className="empty-result"><WandSparkles size={25} /><span>{processing ? "نحلل الصورة ونفصل العناصر..." : "جاهزة للمعالجة"}</span></div>}</div>
                </div>
                {(processing || stage === "ready") && <div className="stage-rail"><div className={stage !== "idle" ? "stage active" : "stage"}><span>{stage === "analyzing" ? <Loader2 size={12} className="spin" /> : <Zap size={12} />}</span><b>تحليل سريع</b></div><div className={stage === "refining" || stage === "ready" ? "stage active" : "stage"}><span>{stage === "refining" ? <Loader2 size={12} className="spin" /> : <Layers3 size={12} />}</span><b>تنقية الحواف</b></div><div className={stage === "ready" ? "stage active" : "stage"}><span><Check size={12} /></span><b>جاهز</b></div></div>}
                {(processing || stage === "ready") && <div className="progress-row"><div className="progress-track"><div style={{ width: `${progress}%` }} /></div><span>{processing ? phase : "100% محلي"}</span></div>}
                {error && <div className="error-message"><CircleHelp size={15} /> {error}</div>}
                <div className="workspace-actions">
                  {!hasResult ? <button className="primary-button process-button" onClick={processImage} disabled={processing}>{processing ? <><Loader2 size={18} className="spin" /> {phase}</> : <><WandSparkles size={18} /> إزالة الخلفية</>}</button> : <><div className="background-picker"><span>الخلفية</span><button className={bgMode === "transparent" ? "active" : ""} onClick={() => setBgMode("transparent")}><i className="checker-mini" /> شفافة</button><button className={bgMode === "white" ? "active" : ""} onClick={() => setBgMode("white")}><i className="white-mini" /> بيضاء</button><button className={bgMode === "warm" ? "active" : ""} onClick={() => setBgMode("warm")}><i className="warm-mini" /> دافئة</button></div><button className="primary-button process-button" onClick={download} disabled={processing}><Download size={18} /> {processing ? "نحسّن النتيجة..." : "تنزيل الصورة"}</button></>}
                </div>
              </div>
            )}
          </div>
          <div className="trust-row"><span><Check size={14} /> معالجة على جهازك</span><span><LockKeyhole size={14} /> صورك لا تُحفظ</span><span><Layers3 size={14} /> حواف دقيقة</span></div>
        </section>

        <section id="features" className="feature-section">
          <div className="section-kicker">لماذا شفّاف؟</div>
          <div className="feature-heading"><h2>أكثر من مجرد<br /><span>إزالة خلفية.</span></h2><p>ذكاء يفهم الصورة، لا يكتفي بقصّها.<br />جرّب الفرق بنفسك.</p></div>
          <div className="feature-grid">
            <article className="feature-card featured-card"><div className="feature-visual visual-orbit"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit-core"><WandSparkles size={25} /></div></div><div className="feature-number">01</div><h3>يفهم كل عنصر</h3><p>يتعرّف على الأشخاص، المنتجات، الحيوانات، وحتى التفاصيل الصغيرة.</p></article>
            <article className="feature-card"><div className="feature-visual visual-edge"><div className="edge-line" /><span>حواف طبيعية</span></div><div className="feature-number">02</div><h3>حواف لا تُلاحظ</h3><p>شعر، زجاج، وأطراف معقدة — نتيجة نظيفة تحافظ على التفاصيل.</p></article>
            <article className="feature-card"><div className="feature-visual visual-speed"><span className="speed-number">GPU</span><div className="speed-line" /></div><div className="feature-number">03</div><h3>نتيجة تظهر أولاً</h3><p>معاينة سريعة تسبق التنقية النهائية، مباشرة من جهازك.</p></article>
          </div>
        </section>

        <section id="how" className="steps-section"><div className="steps-intro"><div className="section-kicker">ثلاث خطوات فقط</div><h2>من صورة عادية<br /><span>إلى شيء مميز.</span></h2></div><div className="steps-list"><div className="step"><span>01</span><div><h3>ارفع صورتك</h3><p>اسحب الصورة إلى المساحة أو اخترها من جهازك.</p></div></div><div className="step"><span>02</span><div><h3>دع الذكاء يعمل</h3><p>شفّاف يحدد العناصر ويفصل الخلفية تلقائياً.</p></div></div><div className="step"><span>03</span><div><h3>نزّل وابدأ</h3><p>احصل على PNG شفاف جاهز للتصميم والاستخدام.</p></div></div></div></section>

        <section id="privacy" className="privacy-banner"><div><div className="section-kicker">خصوصيتك أولاً</div><h2>صورك لك.<br /><span>دائماً.</span></h2><p>المعالجة تتم داخل جهازك. لا رفع للسحابة، لا تخزين، ولا مفاجآت.</p></div><div className="privacy-seal"><LockKeyhole size={25} /><span>خصوصية<br />100%</span></div></section>
      </main>
      <footer><div className="brand"><span className="brand-mark"><Sparkles size={14} /></span><span>شفّاف</span></div><span>صُمم ليجعل صورك أوضح.</span><span>© 2026 شفّاف</span></footer>
    </div>
  );
}
