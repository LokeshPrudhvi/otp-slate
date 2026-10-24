import "./loading.css";

export type LoadingVariant =
  "content" | "cards" | "table" | "workspace" | "inline";

type LoadingStateProps = {
  label?: string;
  detail?: string;
  variant?: LoadingVariant;
  fullScreen?: boolean;
};

function Lines({ count = 3 }: { count?: number }) {
  return (
    <div className="slate-loading__lines">
      {Array.from({ length: count }, (_, index) => (
        <span className="slate-loading__line" key={index} />
      ))}
    </div>
  );
}

function Skeleton({ variant }: { variant: Exclude<LoadingVariant, "inline"> }) {
  return (
    <div
      className={`slate-loading__skeleton slate-loading__skeleton--${variant}`}
      aria-hidden="true"
    >
      {variant === "cards" ? (
        Array.from({ length: 3 }, (_, index) => (
          <div className="slate-loading__card" key={index}>
            <div className="slate-loading__cover" />
            <Lines />
          </div>
        ))
      ) : variant === "table" ? (
        <>
          <div className="slate-loading__filters">
            <span />
            <span />
            <span />
          </div>
          {Array.from({ length: 5 }, (_, index) => (
            <div className="slate-loading__row" key={index}>
              <span className="slate-loading__dot" />
              <span className="slate-loading__line" />
              <span className="slate-loading__pill" />
            </div>
          ))}
        </>
      ) : variant === "workspace" ? (
        <>
          <div className="slate-loading__pane">
            <span className="slate-loading__block" />
            <Lines count={5} />
          </div>
          <div className="slate-loading__pane">
            <Lines count={7} />
          </div>
        </>
      ) : (
        <div className="slate-loading__preview">
          <span className="slate-loading__block" />
          <Lines />
        </div>
      )}
    </div>
  );
}

/** Presentation only: callers keep ownership of fetching and error states. */
export function LoadingState({
  label = "Getting things ready",
  detail,
  variant = "content",
  fullScreen = false,
}: LoadingStateProps) {
  const inline = variant === "inline";
  return (
    <div
      className={`slate-loading slate-loading--${variant}${fullScreen && !inline ? " slate-loading--fullscreen" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="slate-loading__panel">
        <div className="slate-loading__heading">
          {fullScreen && !inline ? (
            <div className="slate-loading__brand" aria-hidden="true">
              <span className="slate-loading__mark">
                otp
                <span />
              </span>
              <span className="slate-loading__brand-name">Slate</span>
            </div>
          ) : null}
          <div className="slate-loading__message">
            <span className="slate-loading__spinner" aria-hidden="true" />
            <p className="slate-loading__label">{label}</p>
          </div>
          {detail ? <p className="slate-loading__detail">{detail}</p> : null}
        </div>
        {!inline ? <Skeleton variant={variant} /> : null}
      </div>
    </div>
  );
}
