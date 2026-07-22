import Link from 'next/link';

export default function BuilderProfile({ params }: { params: { builder: string } }) {
  const builderName = params.builder;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl p-8 shadow-2xl text-center border border-slate-700">
        <div className="w-24 h-24 bg-slate-600 rounded-full mx-auto mb-4 border-4 border-green-400"></div>
        <h1 className="text-3xl font-bold capitalize mb-1">{builderName}</h1>
        <p className="text-slate-400 text-sm">Blockchain Developer | AI Builder</p>
        
        <div className="flex justify-center gap-6 mt-4 text-slate-300 text-sm">
          <span className="cursor-pointer hover:text-white">𝕏 Twitter</span>
          <span className="cursor-pointer hover:text-white">🐙 GitHub</span>
        </div>

        <div className="bg-slate-700/50 rounded-xl p-4 mt-6 flex justify-around border border-slate-600">
          <div>
            <div className="text-xl font-bold text-green-400">12</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Completed</div>
          </div>
          <div>
            <div className="text-xl font-bold text-yellow-400">⭐ 5.0</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Rating</div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button className="w-full py-3 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-all font-medium">
            ☕ Tip Me
          </button>
          <Link href={`/project/new?builder=${builderName}`}>
            <button className="w-full py-3 rounded-xl bg-green-500 text-slate-900 font-bold text-lg hover:bg-green-400 transition-all">
              🚀 Start Project
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}