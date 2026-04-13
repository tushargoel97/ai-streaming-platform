import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center text-center">
      <h1 className="text-6xl font-bold text-white">404</h1>
      <p className="mt-4 text-lg text-gray-400">Page not found</p>
      <Link
        to="/"
        className="mt-8 rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Go Home
      </Link>
    </div>
  );
}
