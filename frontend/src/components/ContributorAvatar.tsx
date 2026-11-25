import { useState } from "react";

export function ContributorAvatar({ login, src }: { login: string; src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span className="rank-avatar" aria-hidden="true">
      {login.slice(0, 1).toUpperCase()}
      {src && src !== failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />}
    </span>
  );
}
