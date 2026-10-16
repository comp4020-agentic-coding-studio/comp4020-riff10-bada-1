"use client";
import { useEffect, useState, type FormEvent } from "react";

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setName(localStorage.getItem("plenty:name") ?? ""), []);

  const remember = (): string => {
    const n = name.trim() || "Guest";
    localStorage.setItem("plenty:name", n);
    return n;
  };

  async function create(pace: "normal" | "rapid"): Promise<void> {
    remember();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pace }) });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      location.href = `/play/?room=${code}`;
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  function join(e: FormEvent): void {
    e.preventDefault();
    remember();
    const c = code.trim().toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(c)) location.href = `/play/?room=${c}`;
    else setError("A room code is five letters and numbers.");
  }

  return (
    <main className="landing">
      <div className="card hero">
        <h1>Plenty</h1>
        <p className="lede">
          Arrive on a little island with your friends. Gather, build homes, run a factory, stake a claim, earn a datacentre and teach it to do the
          gathering for you. The Green Lobby will put some of it back, for a while. When the island is used up, the Plenty Cooperative has another
          world ready. It has five.
        </p>
        <label>
          Your name <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="Guest" />
        </label>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void create("normal")}>
            Start a new world
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void create("rapid")}>
            Start on the rapid preset (testing: 5× clock)
          </button>
        </div>
        <form onSubmit={join} className="row">
          <label>
            Room code <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value)} placeholder="ABC23" autoCapitalize="characters" />
          </label>
          <button type="submit">Join a friend</button>
        </form>
        {error && <p role="alert" className="bad">{error}</p>}
        <p className="small">
          2–8 players, no account, best in a desktop browser with a keyboard. <a href="/readme/">About the game and how it works</a>
        </p>
      </div>
    </main>
  );
}
