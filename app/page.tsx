'use client';

import { useEffect } from 'react';

export default function LandingPage() {
  useEffect(() => {
    // Scroll reveal
    const revealObs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
      }),
      { threshold: 0.08 }
    );
    document.querySelectorAll('.rv').forEach((el) => revealObs.observe(el));

    // Count-up animation with easeOut
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const animateCounter = (el: Element) => {
      const target = parseFloat(el.getAttribute('data-target') || '0');
      const suffix = el.getAttribute('data-suffix') || '';
      const prefix = el.getAttribute('data-prefix') || '';
      const decimals = parseInt(el.getAttribute('data-decimals') || '0');
      const duration = 1600;
      const startTime = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const val = easeOut(progress) * target;
        el.textContent = prefix + val.toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = prefix + target.toFixed(decimals) + suffix;
      };
      requestAnimationFrame(tick);
    };

    const counterObs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { animateCounter(e.target); counterObs.unobserve(e.target); }
      }),
      { threshold: 0.5 }
    );
    document.querySelectorAll('.count-up').forEach((el) => counterObs.observe(el));

    // Count-DOWN for <2s — animates from high number down to 2
    const animateCountDown = (el: Element) => {
      const from = parseFloat(el.getAttribute('data-from') || '5');
      const to = parseFloat(el.getAttribute('data-to') || '2');
      const suffix = el.getAttribute('data-suffix') || '';
      const prefix = el.getAttribute('data-prefix') || '';
      const decimals = parseInt(el.getAttribute('data-decimals') || '1');
      const duration = 1600;
      const startTime = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const val = from - easeOut(progress) * (from - to);
        el.textContent = prefix + val.toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = prefix + to.toFixed(decimals) + suffix;
      };
      requestAnimationFrame(tick);
    };

    const countDownObs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { animateCountDown(e.target); countDownObs.unobserve(e.target); }
      }),
      { threshold: 0.5 }
    );
    document.querySelectorAll('.count-down').forEach((el) => countDownObs.observe(el));

    // Staggered step cards — fire once when steps section enters view
    const stepsContainer = document.querySelector('.steps');
    if (stepsContainer) {
      const staggerObs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              const cards = e.target.querySelectorAll('.s-card');
              cards.forEach((card, idx) => {
                setTimeout(() => card.classList.add('s-in'), idx * 160);
              });
              staggerObs.unobserve(e.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      staggerObs.observe(stepsContainer);
    }


    return () => { revealObs.disconnect(); counterObs.disconnect(); countDownObs.disconnect(); };
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --v: #6C63FF;
          --b: #4A90D9;
          --t: #00C2C7;
          --dk:  #0B0D17;
          --dk2: #111422;
          --w:   #ffffff;
          --off: #F8F9FC;
          --ink: #0F1117;
          --ink2: #3D4250;
          --ink3: #717585;
          --ink4: #A8ABBE;
          --bdr:  #E4E6EF;
          --grad: linear-gradient(135deg, #6C63FF 0%, #4A90D9 55%, #00C2C7 100%);
        }

        html { scroll-behavior: smooth; }

        body {
          font-family: 'Inter', sans-serif;
          background: var(--w);
          color: var(--ink);
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* ── GRADIENT TEXT ── */
        .gt {
          background: var(--grad);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* ── REVEAL ── */
        .rv { opacity: 0; transform: translateY(16px); transition: opacity 0.55s ease, transform 0.55s ease; }
        .rv.in { opacity: 1; transform: none; }
        .rv.d1 { transition-delay: 0.05s; }
        .rv.d2 { transition-delay: 0.12s; }
        .rv.d3 { transition-delay: 0.19s; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes wave {
          from { height: 3px; opacity: .4; }
          to   { height: var(--h, 18px); opacity: 1; }
        }

        /* ─────────────────────────────────────────
           NAV
        ───────────────────────────────────────── */
        .nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200;
          height: 60px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 28px;
          background: rgba(255,255,255,0.94);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--bdr);
        }

        .nav-logo {
          display: flex; align-items: center; gap: 9px;
          text-decoration: none; flex-shrink: 0;
        }
        .nav-mark {
          width: 32px; height: 32px; border-radius: 8px;
          background: var(--grad);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 1px 10px rgba(108,99,255,.28);
          flex-shrink: 0;
        }
        .nav-word {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 17px; font-weight: 700; letter-spacing: -.2px;
          color: var(--ink);
        }

        .nav-links { display: flex; gap: 24px; }
        .nav-links a {
          font-size: 14px; font-weight: 400; color: var(--ink3);
          text-decoration: none; cursor: pointer;
          transition: color .18s;
        }
        .nav-links a:hover { color: var(--ink); }

        .nav-right { display: flex; gap: 8px; flex-shrink: 0; }

        .btn-soft {
          font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
          color: var(--ink2); background: none;
          border: 1px solid var(--bdr);
          padding: 6px 14px; border-radius: 7px;
          cursor: pointer; text-decoration: none;
          transition: all .18s; white-space: nowrap;
        }
        .btn-soft:hover { background: var(--off); }

        .btn-fill {
          font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
          color: #fff; background: var(--grad);
          border: none; padding: 7px 16px; border-radius: 7px;
          cursor: pointer; text-decoration: none;
          box-shadow: 0 1px 12px rgba(108,99,255,.26);
          transition: all .18s; white-space: nowrap;
        }
        .btn-fill:hover { transform: translateY(-1px); box-shadow: 0 3px 18px rgba(108,99,255,.4); }

        /* ─────────────────────────────────────────
           HERO
        ───────────────────────────────────────── */
        .hero {
          padding: 112px 24px 80px;
          display: flex; flex-direction: column; align-items: center;
          text-align: center; position: relative; overflow: hidden;
          background: var(--w);
        }

        /* soft radial wash — contained, won't bleed */
        .hero::before {
          content: '';
          position: absolute; top: 0; left: 50%; transform: translateX(-50%);
          width: 640px; height: 480px; border-radius: 50%;
          background: radial-gradient(ellipse,
            rgba(108,99,255,.06) 0%,
            rgba(0,194,199,.03) 50%,
            transparent 72%);
          pointer-events: none;
        }

        .hero > * { position: relative; z-index: 1; }

        /* pill badge */
        .h-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 100px;
          border: 1px solid rgba(108,99,255,.2);
          background: rgba(108,99,255,.05);
          font-size: 11px; font-weight: 600; color: var(--v);
          letter-spacing: .5px; text-transform: uppercase;
          margin-bottom: 24px;
          animation: fadeUp .45s ease both;
        }
        .h-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--t); box-shadow: 0 0 5px var(--t);
          animation: blink 2.2s ease infinite; flex-shrink: 0;
        }

        /* hero headline — Plus Jakarta Sans, tight but controlled */
        .h-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: clamp(32px, 5.5vw, 60px);
          font-weight: 800;
          line-height: 1.12;
          letter-spacing: -0.5px;
          color: var(--ink);
          max-width: 640px;
          margin-bottom: 18px;
          animation: fadeUp .45s .07s ease both;
        }

        .h-sub {
          font-size: 16px; font-weight: 400; line-height: 1.75;
          color: var(--ink3);
          max-width: 460px; margin: 0 auto 36px;
          animation: fadeUp .45s .14s ease both;
        }

        .h-btns {
          display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
          animation: fadeUp .45s .2s ease both;
        }

        .btn-cta {
          font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600;
          color: #fff; background: var(--grad);
          border: none; padding: 12px 26px; border-radius: 10px;
          cursor: pointer; text-decoration: none;
          box-shadow: 0 3px 20px rgba(108,99,255,.32);
          transition: all .22s; display: inline-block;
        }
        .btn-cta:hover { transform: translateY(-1px); box-shadow: 0 5px 26px rgba(108,99,255,.44); }

        .btn-outline {
          font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 500;
          color: var(--ink2); background: var(--w);
          border: 1.5px solid var(--bdr);
          padding: 12px 24px; border-radius: 10px;
          cursor: pointer; text-decoration: none;
          transition: all .18s; display: inline-block;
        }
        .btn-outline:hover { border-color: #C6CADB; background: var(--off); }

        /* ─────────────────────────────────────────
           MOCKUP
        ───────────────────────────────────────── */
        .mockup-wrap {
          margin-top: 52px; width: 100%; max-width: 840px;
          animation: fadeUp .6s .28s ease both;
        }
        .mockup-shell {
          background: var(--w);
          border: 1.5px solid var(--bdr);
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 16px 48px rgba(0,0,0,.06), 0 2px 12px rgba(108,99,255,.04);
        }
        .m-topbar {
          display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
        }
        .m-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .m-r { background:#FF5F57; } .m-y { background:#FFBD2E; } .m-g { background:#28CA41; }
        .m-urlbar {
          flex: 1; background: var(--off); border-radius: 5px; height: 22px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; color: var(--ink4);
          font-family: 'Inter', sans-serif;
        }

        .m-body { display: grid; grid-template-columns: 190px 1fr; gap: 10px; height: 320px; }

        /* sidebar */
        .m-sb {
          background: var(--off); border-radius: 9px; padding: 12px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .m-sb-lbl {
          font-size: 9px; font-weight: 700; letter-spacing: .9px;
          text-transform: uppercase; color: var(--ink4); margin-bottom: 8px;
        }
        .m-pt {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 8px; border-radius: 7px;
        }
        .m-pt.on { background: var(--w); box-shadow: 0 1px 3px rgba(0,0,0,.05); }
        .m-av {
          width: 28px; height: 28px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; color: #fff;
          font-family: 'Plus Jakarta Sans', sans-serif; flex-shrink: 0;
        }
        .a1{background:linear-gradient(135deg,#6C63FF,#4A90D9)}
        .a2{background:linear-gradient(135deg,#00C2C7,#4A90D9)}
        .a3{background:linear-gradient(135deg,#F87171,#FB923C)}
        .a4{background:linear-gradient(135deg,#34D399,#14B8A6)}
        .m-pn { font-size: 11px; font-weight: 500; color: var(--ink); }
        .m-ps { font-size: 10px; color: var(--ink4); }
        .live { display: inline-flex; align-items: center; gap: 3px; color: #059669; font-weight: 500; }
        .livd { width: 4px; height: 4px; border-radius: 50%; background: #10B981; }

        /* main panel */
        .m-main { display: flex; flex-direction: column; gap: 9px; }

        .m-kpis { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; }
        .m-kpi {
          background: var(--w); border: 1px solid var(--bdr);
          border-radius: 7px; padding: 10px 8px;
        }
        .m-kpi-l { font-size: 9px; color: var(--ink4); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 3px; }
        .m-kpi-v {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 18px; font-weight: 800; color: var(--ink);
        }
        .m-kpi-v.ct { color: var(--t); }
        .m-kpi-v.cv { color: var(--v); }
        .m-kpi-s { font-size: 9px; color: var(--ink4); margin-top: 1px; }

        .m-card {
          flex: 1; background: var(--w); border: 1px solid var(--bdr);
          border-radius: 9px; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
          overflow: hidden;
        }
        .m-ch { display: flex; align-items: center; justify-content: space-between; }
        .m-ct { font-size: 11px; font-weight: 600; color: var(--ink); }
        .m-tag {
          font-size: 9px; font-weight: 600; padding: 2px 7px;
          border-radius: 100px; background: rgba(0,194,199,.1);
          color: #0891B2; border: 1px solid rgba(0,194,199,.18);
        }

        .m-rows { display: flex; flex-direction: column; gap: 5px; }
        .m-row {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 8px; border-radius: 6px; background: var(--off);
        }
        .m-ico {
          width: 22px; height: 22px; border-radius: 5px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ic1{background:rgba(108,99,255,.1)} .ic2{background:rgba(74,144,217,.1)} .ic3{background:rgba(0,194,199,.1)}
        .m-rn { flex: 1; font-size: 10px; font-weight: 500; color: var(--ink); }
        .m-rr { font-size: 9px; color: var(--ink4); flex-shrink: 0; }
        .m-bg { width: 44px; height: 3px; background: #E4E6EF; border-radius: 2px; flex-shrink: 0; }
        .m-br { height: 100%; border-radius: 2px; background: var(--grad); }

        .m-ai {
          background: rgba(108,99,255,.04);
          border: 1px solid rgba(108,99,255,.1);
          border-radius: 7px; padding: 9px 10px;
          display: flex; align-items: flex-start; gap: 7px;
        }
        .m-ai-ic {
          width: 18px; height: 18px; border-radius: 4px; background: var(--grad);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .m-ai-t { font-size: 10px; line-height: 1.55; color: var(--ink2); }
        .m-ai-t strong { color: var(--v); font-weight: 600; }

        /* ─────────────────────────────────────────
           STATS BAND
        ───────────────────────────────────────── */
        .s-band { background: var(--dk); }
        .s-inner {
          max-width: 1080px; margin: 0 auto;
          display: grid; grid-template-columns: repeat(4,1fr);
        }
        .s-cell {
          padding: 36px 20px; text-align: center;
          border-right: 1px solid rgba(255,255,255,.05);
        }
        .s-cell:last-child { border-right: none; }
        .s-big {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 30px; font-weight: 800;
          background: var(--grad);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; line-height: 1;
        }
        .s-desc {
          font-size: 12px; color: rgba(255,255,255,.38);
          margin-top: 6px; line-height: 1.55;
        }

        /* HIPAA shimmer sweep */
        .s-shimmer {
          position: relative; overflow: hidden;
        }
        .s-shimmer::after {
          content: '';
          position: absolute; top: 0; left: -100%;
          width: 60%; height: 100%;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(255,255,255,.18) 50%,
            transparent 100%);
          animation: shimmer 2.8s ease 0.6s infinite;
        }
        @keyframes shimmer {
          0%   { left: -60%; }
          60%  { left: 120%; }
          100% { left: 120%; }
        }

        /* ─────────────────────────────────────────
           SHARED SECTION CHROME
        ───────────────────────────────────────── */
        .wrap { max-width: 1080px; margin: 0 auto; padding: 72px 24px; }

        .eyebrow {
          font-size: 11px; font-weight: 600; letter-spacing: 1.4px;
          text-transform: uppercase; color: var(--v); margin-bottom: 12px;
        }

        /* The key change: Plus Jakarta Sans, reasonable weight, controlled size */
        .h2 {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: clamp(22px, 3.2vw, 38px);
          font-weight: 700;
          letter-spacing: -0.3px;
          line-height: 1.2;
          color: var(--ink);
          margin-bottom: 14px;
        }
        .h2.light { color: #fff; }

        .lead {
          font-size: 16px; font-weight: 400; line-height: 1.75;
          color: var(--ink3); max-width: 460px; margin-bottom: 44px;
        }

           HOW IT WORKS
        ───────────────────────────────────────── */
        .how-bg { background: var(--off); }

        .steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }

        /* stagger: each card slides up with increasing delay */
        .s-card {
          background: var(--w); border: 1px solid var(--bdr);
          border-radius: 14px; padding: 28px;
          position: relative; overflow: hidden;
          opacity: 0; transform: translateY(24px);
          transition: opacity 0.5s ease, transform 0.5s ease, border-color 0.2s, box-shadow 0.2s;
        }
        .s-card.s-in { opacity: 1; transform: none; }
        .s-card:hover { border-color: rgba(108,99,255,.2); box-shadow: 0 6px 24px rgba(108,99,255,.07); }

        /* step number — gradient text, visible but not overpowering */
        .s-n {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 8px;
          background: var(--grad);
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 800;
          color: #fff;
          margin-bottom: 16px;
          flex-shrink: 0;
        }

        /* connector line between steps on desktop */
        .steps-connector {
          display: flex; align-items: flex-start;
          gap: 0; position: relative;
        }
        .steps-connector::before {
          content: '';
          position: absolute;
          top: 44px; left: calc(33.33% - 7px); right: calc(33.33% - 7px);
          height: 1.5px;
          background: linear-gradient(90deg, rgba(108,99,255,.3) 0%, rgba(0,194,199,.3) 100%);
          z-index: 0;
          pointer-events: none;
        }

        .s-ico {
          width: 44px; height: 44px; border-radius: 11px;
          background: rgba(108,99,255,.07);
          border: 1px solid rgba(108,99,255,.12);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 16px;
        }
        .s-card h3 {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px; font-weight: 700;
          color: var(--ink); margin-bottom: 8px;
        }
        .s-card p { font-size: 13px; line-height: 1.7; color: var(--ink3); }

        /* ─────────────────────────────────────────
           FEATURES
        ───────────────────────────────────────── */
        .feat-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }

        .f-card {
          background: var(--w); border: 1.5px solid var(--bdr);
          border-radius: 14px; padding: 28px;
          transition: border-color .2s, box-shadow .2s, transform .2s;
        }
        .f-card:hover {
          border-color: rgba(108,99,255,.2);
          box-shadow: 0 6px 28px rgba(108,99,255,.06);
          transform: translateY(-2px);
        }
        .f-card.wide {
          grid-column: span 2;
          display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
          align-items: center;
        }
        .f-ico {
          width: 42px; height: 42px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 18px;
        }
        .fv{background:rgba(108,99,255,.09)} .ft{background:rgba(0,194,199,.09)} .fb{background:rgba(74,144,217,.09)}
        .f-card h3 {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px; font-weight: 700;
          color: var(--ink); margin-bottom: 8px;
        }
        .f-card p { font-size: 13px; line-height: 1.7; color: var(--ink3); }

        /* AI demo widget inside featured card */
        .ai-demo {
          background: var(--off); border: 1px solid var(--bdr);
          border-radius: 11px; padding: 18px;
        }
        .ai-bub {
          background: var(--w); border: 1px solid rgba(108,99,255,.12);
          border-radius: 10px; padding: 12px 14px;
          display: flex; gap: 9px; margin-bottom: 12px;
        }
        .ai-bub-ic {
          width: 26px; height: 26px; border-radius: 6px; background: var(--grad);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ai-bub-t { font-size: 12px; line-height: 1.55; color: var(--ink2); }
        .ai-bub-t strong { color: var(--v); font-weight: 600; }
        .wf { display: flex; align-items: center; gap: 3px; height: 28px; }
        .wb {
          width: 3px; border-radius: 2px; background: var(--grad);
          animation: wave var(--d,.8s) ease-in-out infinite alternate;
          animation-delay: var(--dl,0s);
        }
        .wl { font-size: 10px; color: var(--ink4); margin-left: 6px; font-family:'Inter',sans-serif; }

        /* ─────────────────────────────────────────
           TESTIMONIALS
        ───────────────────────────────────────── */
        .t-bg { background: var(--dk); }
        .t-inner { max-width: 1080px; margin: 0 auto; padding: 72px 24px; }
        .t-bg .eyebrow { color: var(--t); }

        .t-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-top: 40px; }
        .t-card {
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 14px; padding: 24px;
        }
        .stars { color: #FBBF24; font-size: 13px; letter-spacing: 2px; margin-bottom: 12px; }
        .t-q {
          font-size: 13px; line-height: 1.78;
          color: rgba(255,255,255,.56); font-style: italic; margin-bottom: 18px;
        }
        .t-who { display: flex; align-items: center; gap: 9px; }
        .t-av {
          width: 34px; height: 34px; border-radius: 50%; background: var(--grad);
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: #fff;
          font-family: 'Plus Jakarta Sans', sans-serif; flex-shrink: 0;
        }
        .t-name { font-size: 12px; font-weight: 600; color: rgba(255,255,255,.85); }
        .t-role { font-size: 11px; color: rgba(255,255,255,.35); }

        /* ─────────────────────────────────────────
           COMPLIANCE
        ───────────────────────────────────────── */
        .c-bg { background: var(--off); }
        .c-inner {
          max-width: 1080px; margin: 0 auto; padding: 72px 24px;
          display: grid; grid-template-columns: 1fr 320px; gap: 52px;
          align-items: center;
        }
        .c-badges { display: flex; flex-direction: column; gap: 9px; }
        .c-badge {
          display: flex; align-items: center; gap: 10px;
          padding: 11px 16px; border-radius: 9px;
          background: var(--w); border: 1px solid var(--bdr);
          font-size: 13px; font-weight: 500; color: var(--ink2);
          box-shadow: 0 1px 3px rgba(0,0,0,.03);
        }
        .c-bico {
          width: 26px; height: 26px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .bg-g{background:rgba(16,185,129,.09)} .bg-b{background:rgba(74,144,217,.09)} .bg-v{background:rgba(108,99,255,.09)}

        /* ─────────────────────────────────────────
           CTA
        ───────────────────────────────────────── */
        .cta-bg { background: var(--dk); }
        .cta-wrap { max-width: 1080px; margin: 0 auto; padding: 72px 24px; }
        .cta-box {
          background: linear-gradient(135deg, rgba(108,99,255,.13) 0%, rgba(0,194,199,.08) 100%);
          border: 1px solid rgba(108,99,255,.18);
          border-radius: 20px; padding: 64px 40px;
          text-align: center; position: relative; overflow: hidden;
        }
        .cta-box::before {
          content: ''; position: absolute;
          width: 500px; height: 360px; border-radius: 50%;
          background: radial-gradient(circle, rgba(108,99,255,.1) 0%, transparent 70%);
          top: 50%; left: 50%; transform: translate(-50%,-50%);
          pointer-events: none;
        }
        .cta-box > * { position: relative; z-index: 1; }
        .cta-t {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: clamp(22px, 3.2vw, 38px);
          font-weight: 700; letter-spacing: -.3px; line-height: 1.2;
          color: #fff; margin-bottom: 14px;
        }
        .cta-s { font-size: 15px; color: rgba(255,255,255,.48); margin-bottom: 32px; }
        .cta-btns { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .btn-ghost-dk {
          font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 500;
          color: rgba(255,255,255,.65); background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.1);
          padding: 12px 24px; border-radius: 10px;
          cursor: pointer; text-decoration: none; transition: all .18s;
        }
        .btn-ghost-dk:hover { color: #fff; border-color: rgba(255,255,255,.22); }

        /* ─────────────────────────────────────────
           FOOTER
        ───────────────────────────────────────── */
        .ft-bg { background: var(--dk); border-top: 1px solid rgba(255,255,255,.05); }
        .ft-inner {
          max-width: 1080px; margin: 0 auto; padding: 32px 24px;
          display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px;
        }
        .ft-left { display: flex; flex-direction: column; gap: 6px; }
        .ft-tag { font-size: 12px; color: rgba(255,255,255,.28); }
        .ft-nav { display: flex; gap: 18px; justify-content: center; flex-wrap: wrap; }
        .ft-nav a {
          font-size: 12px; color: rgba(255,255,255,.33);
          text-decoration: none; transition: color .18s; cursor: pointer;
        }
        .ft-nav a:hover { color: rgba(255,255,255,.65); }
        .ft-r { font-size: 11px; color: rgba(255,255,255,.25); text-align: right; line-height: 1.65; }

        /* ─────────────────────────────────────────
           RESPONSIVE
        ───────────────────────────────────────── */
        @media (max-width: 700px) {
          .nav { padding: 0 16px; height: 54px; }
          .nav-links { display: none; }
          .btn-soft { border: none; background: none; padding: 6px 8px; color: var(--ink3); font-size: 13px; }
          .nav-word { font-size: 16px; }

          .hero { padding: 78px 20px 52px; }
          .h-btns { flex-direction: column; width: 100%; max-width: 320px; }
          .btn-cta, .btn-outline { width: 100%; text-align: center; padding: 13px 20px; }

          .m-body { grid-template-columns: 1fr; height: auto; }
          .m-sb { display: none; }

          .s-inner { grid-template-columns: repeat(2,1fr); }
          .s-cell { border-right: none; border-bottom: 1px solid rgba(255,255,255,.05); padding: 24px 16px; }
          .s-cell:nth-last-child(-n+2) { border-bottom: none; }
          .s-big { font-size: 24px; }

          .wrap { padding: 52px 20px; }
          .h2 { font-size: clamp(20px, 6.5vw, 28px); }
          .lead { font-size: 15px; margin-bottom: 32px; }

          .steps { grid-template-columns: 1fr; gap: 10px; }
          .s-card { opacity: 1; transform: none; transition: opacity 0.5s ease, transform 0.5s ease; }
          .feat-grid { grid-template-columns: 1fr; }
          .f-card.wide { grid-column: span 1; grid-template-columns: 1fr; }
          .t-grid { grid-template-columns: 1fr; gap: 10px; }
          .t-inner { padding: 52px 20px; }

          .c-inner { grid-template-columns: 1fr; gap: 28px; padding: 52px 20px; }
          .c-badges { flex-direction: row; flex-wrap: wrap; }
          .c-badge { font-size: 12px; padding: 9px 12px; }

          .cta-box { padding: 44px 20px; }
          .cta-btns { flex-direction: column; max-width: 280px; margin: 0 auto; }
          .btn-cta.cta, .btn-ghost-dk { width: 100%; text-align: center; }

          .ft-inner { grid-template-columns: 1fr; text-align: center; }
          .ft-r { text-align: center; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav className="nav">
        <a className="nav-logo" href="#">
          <div className="nav-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <span className="nav-word"><span className="gt">Reha</span>bly</span>
        </a>
        <div className="nav-links">
          <a onClick={go('how')}>How it works</a>
          <a onClick={go('features')}>Features</a>
          <a onClick={go('compliance')}>Compliance</a>
        </div>
        <div className="nav-right">
          <a href="/login" className="btn-soft">Log in</a>
          <a href="#" className="btn-fill">Book demo</a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="hero">
        <div className="h-pill">
          <div className="h-dot"/>
          Now in clinical pilot — North America
        </div>

        <h1 className="h-title">
          Rehabilitation,{' '}
          <span className="gt">intelligently guided.</span>
        </h1>

        <p className="h-sub">
          Rehably turns physiotherapy sessions into AI-powered conversations — real-time movement feedback, clinical coaching, and patient insights your physio can act on.
        </p>

        <div className="h-btns">
          <a href="#" className="btn-cta">Get early access</a>
          <a href="#how" className="btn-outline" onClick={go('how')}>See how it works →</a>
        </div>

        {/* DASHBOARD MOCKUP */}
        <div className="mockup-wrap">
          <div className="mockup-shell">
            <div className="m-topbar">
              <div className="m-dot m-r"/><div className="m-dot m-y"/><div className="m-dot m-g"/>
              <div className="m-urlbar">app.rehably.ai — Dashboard</div>
            </div>
            <div className="m-body">
              <div className="m-sb">
                <div className="m-sb-lbl">Patients</div>
                {[
                  {av:'a1',i:'SJ',n:'Sarah J.',s:<span className="live"><span className="livd"/>Live session</span>},
                  {av:'a2',i:'MK',n:'Marcus K.',s:'2 pending'},
                  {av:'a3',i:'AL',n:'Aisha L.',s:'Review needed'},
                  {av:'a4',i:'TC',n:'Tom C.',s:'On track'},
                ].map((p,idx)=>(
                  <div key={idx} className={`m-pt${idx===0?' on':''}`}>
                    <div className={`m-av ${p.av}`}>{p.i}</div>
                    <div><div className="m-pn">{p.n}</div><div className="m-ps">{p.s}</div></div>
                  </div>
                ))}
              </div>

              <div className="m-main">
                <div className="m-kpis">
                  <div className="m-kpi"><div className="m-kpi-l">Completion</div><div className="m-kpi-v ct">94%</div><div className="m-kpi-s">↑12% this month</div></div>
                  <div className="m-kpi"><div className="m-kpi-l">Active</div><div className="m-kpi-v">12</div><div className="m-kpi-s">3 protocols</div></div>
                  <div className="m-kpi"><div className="m-kpi-l">AI insights</div><div className="m-kpi-v cv">7</div><div className="m-kpi-s">Flags to review</div></div>
                </div>
                <div className="m-card">
                  <div className="m-ch">
                    <span className="m-ct">Sarah J. — Post-op Knee Protocol</span>
                    <span className="m-tag">AI Active</span>
                  </div>
                  <div className="m-rows">
                    {[
                      {c:'ic1',col:'#6C63FF',n:'Straight Leg Raise',r:'3×12',w:'100%'},
                      {c:'ic2',col:'#4A90D9',n:'Terminal Knee Extension',r:'3×15',w:'55%'},
                      {c:'ic3',col:'#00C2C7',n:'Step-Ups',r:'2×10',w:'0%'},
                    ].map((ex,idx)=>(
                      <div key={idx} className="m-row">
                        <div className={`m-ico ${ex.c}`}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ex.col} strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        </div>
                        <span className="m-rn">{ex.n}</span>
                        <span className="m-rr">{ex.r}</span>
                        <div className="m-bg"><div className="m-br" style={{width:ex.w}}/></div>
                      </div>
                    ))}
                  </div>
                  <div className="m-ai">
                    <div className="m-ai-ic">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    </div>
                    <div className="m-ai-t"><strong>AI note:</strong> Knee flexion improving — 87° on rep 8 vs 79° last session. Right hip compensation detected; cue glute med on next set.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS BAND ── */}
      <div className="s-band">
        <div className="s-inner">

          {/* 94% — counts up */}
          <div className="s-cell rv">
            <div className="s-big">
              <span className="count-up" data-target="94" data-suffix="%" data-decimals="0">94%</span>
            </div>
            <div className="s-desc"><span>Patient session</span><br/><span>completion rate</span></div>
          </div>

          {/* 3× — counts 1→3 */}
          <div className="s-cell rv">
            <div className="s-big">
              <span className="count-up" data-target="3" data-suffix="×" data-decimals="0">3×</span>
            </div>
            <div className="s-desc"><span>More movement</span><br/><span>data per session</span></div>
          </div>

          {/* HIPAA — no counter, just fade in with a shimmer */}
          <div className="s-cell rv">
            <div className="s-big s-shimmer">HIPAA</div>
            <div className="s-desc"><span>US &amp; Canada</span><br/><span>data residency</span></div>
          </div>

          {/* <2s — counts 5.0→2.0 then flips to <2s */}
          <div className="s-cell rv">
            <div className="s-big">
              <span className="count-down" data-from="5.0" data-to="2" data-suffix="s" data-prefix="&lt;" data-decimals="1">&lt;2s</span>
            </div>
            <div className="s-desc"><span>AI coaching</span><br/><span>response latency</span></div>
          </div>

        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div className="how-bg" id="how">
        <div className="wrap">
          <div className="eyebrow rv">How it works</div>
          <h2 className="h2 rv">From prescription to outcome, intelligently.</h2>
          <p className="lead rv">Rehably bridges the gap between what physios prescribe and what patients actually do.</p>
          <div className="steps">
            {[
              {n:'01',title:'Physio builds the protocol',body:'Create exercise prescriptions, set rep targets, and add clinical context. Protocols take minutes to build and can be reused across patients.',
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C63FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>},
              {n:'02',title:'Patient runs the session',body:'The AI coaches the patient by name, watches their movement through the camera, and provides real-time cues — exactly like having a physio in the room.',
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>},
              {n:'03',title:'Physio reviews the intelligence',body:'Movement flags, compensation patterns, ROM trends, and AI-generated session summaries land in your dashboard — ready to act on.',
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C2C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>},
            ].map((s,i)=>(
              <div key={i} className="s-card">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
                  <div className="s-n">{s.n}</div>
                  <div className="s-ico" style={{margin:0}}>{s.icon}</div>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div id="features">
        <div className="wrap">
          <div className="eyebrow rv">Platform features</div>
          <h2 className="h2 rv">Built for the clinic. Loved by patients.</h2>
          <p className="lead rv">Every feature is grounded in clinical workflow — not retrofitted wellness tech.</p>
          <div className="feat-grid">
            {/* FEATURED WIDE CARD */}
            <div className="f-card wide rv">
              <div>
                <div className="f-ico fv">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C63FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <h3>AI Rehabilitation Engine</h3>
                <p>Powered by Claude, Rehably&apos;s coaching engine holds the patient&apos;s prescription, clinical history, and movement data in context simultaneously. It gives real-time verbal cues, adapts to fatigue, and flags concerns — without exposing raw prompts or model internals.</p>
              </div>
              <div className="ai-demo">
                <div className="ai-bub">
                  <div className="ai-bub-ic">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  </div>
                  <div className="ai-bub-t"><strong>Rehably AI:</strong> &quot;Great work, Sarah. I noticed your right hip dropping slightly — let&apos;s keep the pelvis level on the next set. Ready when you are.&quot;</div>
                </div>
                <div className="wf">
                  {[{h:'22px',d:'.7s',dl:'0s'},{h:'14px',d:'.5s',dl:'.1s'},{h:'26px',d:'.9s',dl:'.2s'},{h:'10px',d:'.6s',dl:'.3s'},{h:'20px',d:'.8s',dl:'.4s'},{h:'8px',d:'.5s',dl:'.5s'},{h:'18px',d:'.7s',dl:'.6s'},{h:'24px',d:'.9s',dl:'.1s'}].map((w,i)=>(
                    <div key={i} className="wb" style={{'--h':w.h,'--d':w.d,'--dl':w.dl} as React.CSSProperties}/>
                  ))}
                  <span className="wl">AI voice coaching — live</span>
                </div>
              </div>
            </div>

            {[
              {cls:'ft',icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C2C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,title:'BlazePose Movement Analysis',body:'Frame-level joint angle tracking runs locally in the browser via BlazePose — no video is stored or transmitted. ROM data accumulates per rep, per exercise, per session.'},
              {cls:'fb',icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,title:'Mobile-first session runner',body:'Patients run sessions from any device. The layout adapts intelligently, keeping the camera view and exercise guidance always visible.'},
              {cls:'fv',icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C63FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,title:'Protocol builder',body:'Build reusable exercise templates with sets, reps, hold durations, and rest periods. Apply protocols to any patient in seconds.'},
              {cls:'ft',icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C2C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,title:'Patient notifications',body:'Automated session reminders and progress updates via email — with CAN-SPAM & CASL-compliant consent tracking. SMS notifications with full regulatory clearance.'},
            ].map((f,i)=>(
              <div key={i} className="f-card rv">
                <div className={`f-ico ${f.cls}`}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TESTIMONIALS ── */}
      <div className="t-bg">
        <div className="t-inner">
          <div className="eyebrow rv">Early clinical feedback</div>
          <h2 className="h2 light rv">What physios are saying.</h2>
          <div className="t-grid">
            {[
              {i:'RP',n:'Dr. Rachel P.',r:'Orthopaedic Physiotherapist, Toronto',q:'"I can finally see what my patients are actually doing between appointments. The movement flags caught a compensation pattern I wouldn\'t have noticed until the follow-up."'},
              {i:'JM',n:'James M., PT',r:'Sports Rehab Clinic, Vancouver',q:'"My patients actually do their home programs now. Having an AI coaching them through it — by name, in real time — changes the compliance equation completely."'},
              {i:'SC',n:'Sandra C., PT',r:'Private Practice, Calgary',q:'"Protocol building used to take 20 minutes per patient. Now it\'s two minutes and I have something reusable. The AI context is a genuine clinical tool."'},
            ].map((t,i)=>(
              <div key={i} className="t-card rv">
                <div className="stars">★★★★★</div>
                <p className="t-q">{t.q}</p>
                <div className="t-who">
                  <div className="t-av">{t.i}</div>
                  <div><div className="t-name">{t.n}</div><div className="t-role">{t.r}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── COMPLIANCE ── */}
      <div className="c-bg" id="compliance">
        <div className="c-inner">
          <div className="rv">
            <div className="eyebrow">Privacy &amp; compliance</div>
            <h2 className="h2">Built for North American healthcare from day one.</h2>
            <p style={{fontSize:'14px',lineHeight:'1.78',color:'var(--ink3)',maxWidth:'420px'}}>
              Built for HIPAA, PIPEDA, and state-level privacy regulations across the US and Canada. No video leaves the patient&apos;s device. Movement data is computed locally — only aggregated metrics are transmitted. Your data stays yours.
            </p>
          </div>
          <div className="c-badges rv">
            {[
              {bg:'bg-g',s:'#10B981',t:'US & Canada data residency',p:<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>},
              {bg:'bg-b',s:'#4A90D9',t:'HIPAA & PIPEDA compliant',p:<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>},
              {bg:'bg-g',s:'#10B981',t:'No video stored or transmitted',p:<><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>},
              {bg:'bg-v',s:'#6C63FF',t:'CAN-SPAM & CASL compliant',p:<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>},
              {bg:'bg-b',s:'#4A90D9',t:'Row-level database security',p:<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>},
            ].map((b,i)=>(
              <div key={i} className="c-badge">
                <div className={`c-bico ${b.bg}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={b.s} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{b.p}</svg>
                </div>
                {b.t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="cta-bg">
        <div className="cta-wrap">
          <div className="cta-box rv">
            <h2 className="cta-t">Ready to transform your clinic&apos;s outcomes?</h2>
            <p className="cta-s">Join clinics across North America in the Rehably early access program.</p>
            <div className="cta-btns">
              <a href="#" className="btn-cta cta">Book a demo</a>
              <a href="#" className="btn-ghost-dk">Talk to the team</a>
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="ft-bg">
        <div className="ft-inner">
          <div className="ft-left">
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <div className="nav-mark" style={{width:'26px',height:'26px',borderRadius:'6px'}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </div>
              <span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:'15px',fontWeight:700,color:'rgba(255,255,255,.78)'}}>
                <span className="gt">Reha</span>bly
              </span>
            </div>
            <span className="ft-tag">AI Rehabilitation Intelligence Platform</span>
          </div>
          <nav className="ft-nav">
            <a href="#">Privacy policy</a>
            <a href="#">Terms</a>
            <a href="#">HIPAA notice</a>
            <a href="#">Contact</a>
          </nav>
          <div className="ft-r">© 2026 Rehably Inc.<br/>US &amp; Canada · HIPAA ready</div>
        </div>
      </div>
    </>
  );
}
