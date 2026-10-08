import { useState } from "react";

export function CompilerPage() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="compiler-fullscreen-container">
      {loading && (
        <div className="compiler-loading-screen">
          <div className="compiler-spinner" />
          <span>Loading Code Studio...</span>
        </div>
      )}
      <iframe
        src="https://onecompiler.com/embed?theme=dark"
        title="Code Compiler"
        width="100%"
        height="100%"
        frameBorder="0"
        allow="clipboard-write; clipboard-read; run-scripts; fullscreen"
        className="compiler-fullscreen-frame"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}
