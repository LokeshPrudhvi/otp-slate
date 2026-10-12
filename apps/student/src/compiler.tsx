import { useState } from "react";
import { useStudentData } from "./access";
import { Status } from "./design";

export function CompilerPage() {
  const [loading, setLoading] = useState(true);
  const capability = useStudentData<{ enabled: true }>(
    "compiler",
    "student/compiler",
  );
  if (!capability.data || capability.error)
    return (
      <div className="a-page">
        <Status pending={capability.isPending} error={capability.error} />
      </div>
    );

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
