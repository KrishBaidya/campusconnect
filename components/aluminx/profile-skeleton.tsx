import "./aluminx.css";

export function ProfileSkeleton() {
  return (
    <div className="ax">
      <main className="main" style={{ maxWidth: 1120 }} aria-busy="true">
        <span className="skel" style={{ height: 180, borderRadius: 20 }} />
        <div style={{ display: "grid", gap: 10, margin: "24px 0" }}>
          <span className="skel" style={{ width: 260, height: 28 }} />
          <span className="skel" style={{ width: "50%", height: 14 }} />
        </div>
        <span className="skel" style={{ width: "70%", height: 14 }} />
      </main>
    </div>
  );
}
