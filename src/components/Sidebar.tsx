import { Compass } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">W</div>
        <div>
          <strong>Whitebox</strong>
          <span>TalentScreen </span>
        </div>
      </div>

      <nav>
        <button className="active">
          <Compass size={20} />
          Job dashboard
        </button>
      </nav>
    </aside>
  );
}
