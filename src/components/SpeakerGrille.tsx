/**
 * SpeakerGrille — decorative speaker cloth area below the controls.
 * Purely visual.
 */
export default function SpeakerGrille() {
  return (
    <div
      className="surface-grille rounded-[14px] h-24 sm:h-28 relative overflow-hidden"
      style={{
        border: "1px solid rgba(0,0,0,0.55)",
      }}
    >
      {/* subtle vertical sheen */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,190,120,0.06) 0%, transparent 40%, rgba(0,0,0,0.35) 100%)",
        }}
      />
      {/* center brass monogram */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="px-5 py-1 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
            boxShadow:
              "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
          }}
        >
          <span className="font-display italic tracking-[0.3em] uppercase text-xs text-walnut-900">
            YIRD
          </span>
        </div>
      </div>
    </div>
  );
}
