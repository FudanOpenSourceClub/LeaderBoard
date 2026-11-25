import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import type Hls from "hls.js";
import { useLanguage } from "../state/language";
import { codeLanes } from "./hero-code";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/latin-400-italic.css";

const signals = [
  "const next = await build();",
  "for (auto& node : frontier) visit(node);",
  "loss = criterion(model(batch), labels)",
];

const streamUrl = "https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8";

function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let release: (() => void) | undefined;
    let generation = 0;

    function syncVideo() {
      const attempt = ++generation;
      release?.();
      release = undefined;
      setPlaying(false);
      if (motion.matches || !video) return;

      let hls: Hls | undefined;
      const play = () => { void video.play().catch(() => {}); };
      release = () => {
        hls?.destroy();
        if (video.getAttribute("src") !== null) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      };

      // Keep the player out of the initial bundle and skip it for reduced motion.
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (attempt !== generation) return;
        if (HlsPlayer.isSupported()) {
          hls = new HlsPlayer({ enableWorker: false, capLevelToPlayerSize: true, maxBufferLength: 12, backBufferLength: 8 });
          hls.on(HlsPlayer.Events.MANIFEST_PARSED, play);
          hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              hls?.destroy();
              hls = undefined;
              setPlaying(false);
            }
          });
          hls.attachMedia(video);
          hls.loadSource(streamUrl);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = streamUrl;
          play();
        }
      }).catch(() => {
        if (attempt === generation) setPlaying(false);
      });
    }

    syncVideo();
    motion.addEventListener("change", syncVideo);
    return () => {
      motion.removeEventListener("change", syncVideo);
      ++generation;
      release?.();
    };
  }, []);

  return <video
    ref={videoRef}
    className="hero-video absolute inset-0 h-full w-full object-cover"
    data-playing={playing}
    autoPlay muted loop playsInline preload="none"
    onPlaying={() => setPlaying(true)}
    onError={() => setPlaying(false)}
  />;
}

function CodeStreams() {
  return <div className="hero-code" aria-hidden="true">
    {codeLanes.map(lane => (
      <div className="hero-code-lane" key={lane.id} data-lane={lane.id} style={{
        "--lane-duration": lane.duration + "s",
        "--lane-phase": lane.phase + "s",
        "--lane-opacity": lane.opacity,
      } as CSSProperties}>
        <div className="hero-code-track">
          {[0, 1].map(copy => (
            <div key={copy} className="hero-code-segment">
              {lane.lines.map(([language, line], index) => (
                <span className="hero-code-snippet" key={line} data-highlight={(index % 5) === 1}>
                  <span className="hero-code-language">{language}</span>
                  <code>{line}</code>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    ))}
    <div className="hero-code-signal">
      {signals.map((signal, index) => <code key={signal} className="hero-typed" style={{
        "--signal-width": signal.length + "ch",
        "--signal-delay": index * 24 + "s",
      } as CSSProperties}>{signal}</code>)}
    </div>
  </div>;
}

export function HomeHero({ startedHref }: { startedHref: string }) {
  const { locale, t } = useLanguage();
  const glow = useId();
  const blur = useId();

  return <section className="leaderboard-hero relative isolate flex items-center overflow-hidden" aria-labelledby="leaderboard-hero-title">
    <div className="hero-scene pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <HeroVideo />
      <div className="hero-video-mask absolute inset-0" />
      <svg className="hero-glow" viewBox="0 0 1440 440" preserveAspectRatio="none" focusable="false">
        <defs>
          <radialGradient id={glow}>
            <stop stopColor="#387558" stopOpacity=".65" />
            <stop offset=".38" stopColor="#205940" stopOpacity=".56" />
            <stop offset=".72" stopColor="#193b30" stopOpacity=".32" />
            <stop offset="1" stopColor="#12271e" stopOpacity="0" />
          </radialGradient>
          <filter id={blur}><feGaussianBlur stdDeviation="25" /></filter>
        </defs>
        <ellipse cx="735" cy="226" rx="690" ry="175" fill={"url(#" + glow + ")"} filter={"url(#" + blur + ")"} />
      </svg>
      <div className="hero-grid absolute inset-0 hidden md:block">
        {[25, 50, 75].map(position => <span key={position} className="absolute inset-y-0 w-px bg-white/10" style={{ left: position + "%" }} />)}
      </div>
      <CodeStreams />
    </div>

    <div className="hero-interior relative mx-auto w-full">
      <div className="hero-content max-w-3xl">
        <p className="hero-eyebrow flex items-center gap-3"><span aria-hidden="true" />{t("复旦开源社区", "FUDAN OPEN SOURCE")}</p>
        <h1 id="leaderboard-hero-title" className="hero-title font-extrabold tracking-tight text-white" lang={locale}>
          <span className="block">{t("探索开源，", "BUILD IN")}</span>{locale === "en" ? " " : null}
          <span className="block">{t("留下你的贡献", "THE OPEN")}<span className="hero-period">{t("。", ".")}</span></span>
        </h1>
        <p className="hero-description max-w-lg text-sm text-white/70">{t(
          "发现精选开源项目，记录你的 GitHub 贡献，看看大家都在做什么。",
          "Discover curated open source projects, track your GitHub contributions, and see what the community is building.",
        )}</p>
        <Link className="hero-cta inline-flex items-center gap-3 rounded-full font-extrabold uppercase" to={startedHref}>
          {t("开始探索", "Get Started")} <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <div className="hero-caption" aria-hidden="true">
        <span>LEADERBOARD / OPEN SOURCE</span>
      </div>
    </div>
  </section>;
}
