type MetricCardProps = {
  title: string;
  amount: string;
  hint?: string;
  gradientIndex?: number;
  kicker?: string;
};

const gradients = [
  "from-[color:var(--spa-wash)] via-[color:var(--spa-border)] to-[color:var(--spa-surface)]",
  "from-[color:var(--spa-surface)] via-[color:var(--spa-border)] to-[color:var(--spa-wash)]",
  "from-[color:var(--spa-wash)] via-[color:var(--spa-accent-soft)] to-[color:var(--spa-wash)]",
  "from-white via-[color:var(--spa-wash)] to-[color:var(--spa-border)]",
];

export default function MetricCard({ title, amount, hint, gradientIndex = 0, kicker }: MetricCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <div className={`h-1.5 w-full bg-gradient-to-r ${gradients[gradientIndex % gradients.length]}`} />
      <div className="space-y-2 p-5">
        {kicker && <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{kicker}</span>}
        <p className="text-sm text-slate-600">{title}</p>
        <p className="text-2xl font-semibold text-slate-900">{amount}</p>
        {hint && <p className="text-sm text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
