type MetricCardProps = {
  title: string;
  amount: string;
  hint?: string;
  gradientIndex?: number;
  kicker?: string;
};

const gradients = [
  "from-cyan-100 via-blue-100 to-purple-100",
  "from-sky-100 via-indigo-100 to-fuchsia-100",
  "from-emerald-100 via-cyan-100 to-blue-100",
  "from-pink-100 via-purple-100 to-slate-100",
];

export default function MetricCard({ title, amount, hint, gradientIndex = 0, kicker }: MetricCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-100/70 bg-white shadow-sm">
      <div className={`h-1.5 w-full bg-gradient-to-r ${gradients[gradientIndex % gradients.length]}`} />
      <div className="space-y-2 p-5">
        {kicker && <span className="text-[11px] uppercase tracking-[0.18em] text-cyan-600">{kicker}</span>}
        <p className="text-sm text-slate-600">{title}</p>
        <p className="text-2xl font-semibold text-slate-900">{amount}</p>
        {hint && <p className="text-sm text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
