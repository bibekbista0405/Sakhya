export default function AppLoading() {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-background" aria-label="Loading">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span>Loading</span>
      </div>
    </div>
  );
}
