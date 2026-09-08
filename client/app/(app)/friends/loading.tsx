export default function FriendsLoading() {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col">
      <div className="border-b border-border bg-surface p-4">
        <div className="h-5 w-20 animate-pulse rounded bg-surface-hover" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-3 h-11 w-full animate-pulse rounded-md bg-surface-hover" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-hover" />)}
      </div>
    </div>
  );
}
