import { useCallback, useEffect, useRef, useState } from "react";

/** Each dashboard list owns its request, recovery and stale-response boundary. */
export function useDashboardList<T>(url: string, field: string, failure: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    void fetch(url)
      .then(async response => {
        if (!response.ok) throw new Error(failure);
        return response.json();
      })
      .then(result => {
        if (request === generation.current) setItems(result[field] || []);
      })
      .catch(() => {
        if (request === generation.current) setError(failure);
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
  }, [url, field, failure]);
  useEffect(() => {
    reload();
    return () => { generation.current += 1; };
  }, [reload]);
  return { items, loading, error, reload };
}
