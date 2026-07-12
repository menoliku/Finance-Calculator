type InfoTipProps = {
  text: string;
};

export default function InfoTip({ text }: InfoTipProps) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      ?
    </span>
  );
}
