import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/DocumentApp.css';

export function Header() {
  return (
    <header className="app-header">
      <div className="app-brand">
        <div className="brand-mark">OB</div>
        <div>
          <div className="brand-title">ObscureBase</div>
          <p className="brand-subtitle">Encrypted documents with shared FHE keys</p>
        </div>
      </div>
      <ConnectButton />
    </header>
  );
}
