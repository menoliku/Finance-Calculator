import { useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type Stock = {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
};

type StockSymbolSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (stock: Stock) => void;
  placeholder?: string;
};

// Reusable company-name-or-ticker autocomplete, backed by /stocks/search --
// extracted so every symbol input in the app (not just the Calculator/
// Analysis tabs) gets real search instead of a bare "type the exact ticker" box.
export default function StockSymbolSearch({
  value,
  onChange,
  onSelect,
  placeholder,
}: StockSymbolSearchProps) {
  const [options, setOptions] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  async function search(query: string) {
    const trimmed = query.trim();

    if (trimmed === "") {
      setOptions([]);
      setShowDropdown(false);
      return;
    }

    try {
      setIsSearching(true);

      const response = await fetch(
        `${API_BASE_URL}/stocks/search?q=${encodeURIComponent(trimmed)}`
      );
      const data = await response.json();

      if (data.error) {
        setOptions([]);
        setShowDropdown(false);
        return;
      }

      setOptions(data);
      setShowDropdown(true);
    } catch (error) {
      console.error(error);
      setOptions([]);
      setShowDropdown(false);
    } finally {
      setIsSearching(false);
    }
  }

  function handleSelect(stock: Stock) {
    setShowDropdown(false);
    setOptions([]);
    onSelect(stock);
  }

  return (
    <div className="stock-search-box">
      <input
        type="text"
        placeholder={placeholder ?? "Search by symbol or company name"}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          void search(e.target.value);
        }}
        onFocus={() => {
          if (options.length > 0) {
            setShowDropdown(true);
          }
        }}
        onBlur={() => {
          // Delay so a click on a dropdown item registers before it unmounts.
          setTimeout(() => setShowDropdown(false), 150);
        }}
      />

      {isSearching && <p className="helper-text">Searching...</p>}

      {showDropdown && options.length > 0 && (
        <ul className="dropdown">
          {options.map((stock) => (
            <li key={stock.symbol} onMouseDown={() => handleSelect(stock)}>
              <strong>{stock.symbol}</strong> - {stock.name}
              <br />
              <small>
                {stock.exchange} | {stock.quoteType}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
