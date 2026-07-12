type AnalystGaugeProps = {
  recommendationMean: number | null;
  recommendationKey: string | null;
  numberOfAnalystOpinions: number | null;
};

function formatRecommendation(key: string | null) {
  if (!key) {
    return "N/A";
  }

  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Yahoo's recommendationMean runs 1 (Strong Buy) to 5 (Strong Sell). The gauge
// reads left-to-right as Sell -> Buy, so the scale is flipped into a 0-100 position.
function meanToPosition(mean: number) {
  const clamped = Math.min(5, Math.max(1, mean));
  return ((5 - clamped) / 4) * 100;
}

function statusClassForMean(mean: number) {
  if (mean <= 2) {
    return "gauge-good";
  }

  if (mean >= 4) {
    return "gauge-critical";
  }

  return "gauge-warning";
}

export default function AnalystGauge({
  recommendationMean,
  recommendationKey,
  numberOfAnalystOpinions,
}: AnalystGaugeProps) {
  if (recommendationMean === null || recommendationMean === undefined) {
    return (
      <p className="empty-text">No analyst rating available for this stock.</p>
    );
  }

  const position = meanToPosition(recommendationMean);
  const statusClass = statusClassForMean(recommendationMean);

  return (
    <div className="analyst-gauge">
      <div className="analyst-gauge-marker-row" style={{ left: `${position}%` }}>
        <span className={`analyst-gauge-marker-label ${statusClass}`}>
          {formatRecommendation(recommendationKey)}
        </span>
        <span className={`analyst-gauge-pointer ${statusClass}`} />
      </div>

      <div className="analyst-gauge-track" />

      <div className="analyst-gauge-scale">
        <span>Strong Sell</span>
        <span>Sell</span>
        <span>Hold</span>
        <span>Buy</span>
        <span>Strong Buy</span>
      </div>

      {numberOfAnalystOpinions ? (
        <p className="helper-text analyst-gauge-count">
          Based on {numberOfAnalystOpinions} analyst opinions
        </p>
      ) : null}
    </div>
  );
}
