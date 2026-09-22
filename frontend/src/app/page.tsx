"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PingResponse = {
  status: string;
  message: string;
};

type ConnectionState =
  | { phase: "loading" }
  | { phase: "success"; data: PingResponse }
  | { phase: "error"; detail: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function Home() {
  const [state, setState] = useState<ConnectionState>({ phase: "loading" });

  const fetchPing = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/ping/`);
      if (!res.ok) {
        throw new Error(`Backend responded with status ${res.status}`);
      }
      const data: PingResponse = await res.json();
      setState({ phase: "success", data });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      setState({ phase: "error", detail });
    }
  }, []);

  useEffect(() => {
    // Data fetching on mount is a documented valid effect use case; the
    // lint rule can't see that the setState calls inside fetchPing all
    // happen after an await, so this false positive is suppressed here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPing();
  }, [fetchPing]);

  const handleRetry = useCallback(() => {
    setState({ phase: "loading" });
    fetchPing();
  }, [fetchPing]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Backend Connection Check</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.phase === "loading" && (
            <p className="text-sm text-muted-foreground">
              Checking backend connection…
            </p>
          )}

          {state.phase === "success" && (
            <div className="flex items-center gap-3">
              <Badge className="bg-green-600 text-white hover:bg-green-600">
                Connected
              </Badge>
              <span className="text-sm text-foreground">
                {state.data.message}
              </span>
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Badge className="bg-red-600 text-white hover:bg-red-600">
                  Connection failed
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{state.detail}</p>
              <Button onClick={handleRetry} className="w-fit">
                Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
