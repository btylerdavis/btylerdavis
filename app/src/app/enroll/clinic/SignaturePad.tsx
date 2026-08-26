"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Built-in signature pad (DEMO.md Act 1-2 table: "Built-in signature pad";
 * e-signature vendor integration held in reserve). Mouse + touch via pointer
 * events. The bitmap is a capture artifact only — the consent engine record
 * is what's persisted.
 */
export function SignaturePad({
  onChange,
}: {
  onChange: (hasInk: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#16304e";
    }
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) {
      setHasInk(true);
      onChange(true);
    }
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasInk(false);
    onChange(false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-36 w-full touch-none rounded-card border border-dashed border-watermark/60 bg-white"
        aria-label="Signature pad"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs text-graphite">
          {hasInk ? "Signature captured" : "Sign above — finger or mouse"}
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-xs font-semibold text-navy underline underline-offset-2"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
