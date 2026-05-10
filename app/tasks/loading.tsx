function TaskCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[1.8rem] border border-sky-100 bg-white p-4 shadow-sm">
      <div className="aspect-[3/4] animate-pulse rounded-[1.35rem] bg-slate-100" />
      <div className="mt-4 h-4 w-32 animate-pulse rounded-full bg-slate-100" />
      <div className="mt-3 h-10 w-28 animate-pulse rounded-full bg-sky-100" />
    </div>
  );
}

export default function TasksLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.8rem] bg-white px-5 py-5 shadow-sm">
          <div>
            <div className="h-4 w-16 animate-pulse rounded-full bg-sky-100" />
            <div className="mt-4 h-12 w-72 animate-pulse rounded-2xl bg-slate-100" />
            <div className="mt-4 h-5 w-96 max-w-full animate-pulse rounded-full bg-slate-100" />
          </div>
          <div className="h-14 w-36 animate-pulse rounded-full bg-sky-100" />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </div>
      </div>
    </div>
  );
}
