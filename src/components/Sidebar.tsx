import { Compass, History } from "lucide-react";

interface SidebarProps {
  currentView: "dashboard" | "history";
  onViewChange: (view: "dashboard" | "history") => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
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
        <button 
          className={currentView === "dashboard" ? "active" : ""} 
          onClick={() => onViewChange("dashboard")}
        >
          <Compass size={20} />
          Job dashboard
        </button>
        <button 
          className={currentView === "history" ? "active" : ""} 
          onClick={() => onViewChange("history")}
        >
          <History size={20} />
          Application History
        </button>
      </nav>
    </aside>
  );
}
