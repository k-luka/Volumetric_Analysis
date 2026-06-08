import { Moon, Sun } from "lucide-react";

type TopBarProps = {
  theme: "dark" | "light";
  onToggleTheme: () => void;
};

export function TopBar({ theme, onToggleTheme }: TopBarProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="app-logo">Bv</div>
        <div className="document-title">Brain Volume Analysis</div>
        <span className="workspace-chip">Local analysis</span>
      </div>
      <button type="button" className="icon-button" aria-label={`Switch to ${nextTheme} mode`} title={`Switch to ${nextTheme} mode`} onClick={onToggleTheme}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
