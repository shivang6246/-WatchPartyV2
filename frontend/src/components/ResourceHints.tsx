"use client";

import ReactDOM from "react-dom";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8080";

/**
 * Opens the connections every page needs before anything asks for them: the
 * API (the session refresh is the first request on any page) and YouTube's
 * image host (every thumbnail and the home backdrop's still). On a phone that
 * saves a DNS lookup, a TCP and a TLS handshake off the first request to each.
 */
export default function ResourceHints() {
  ReactDOM.preconnect(API_BASE, { crossOrigin: "use-credentials" });
  ReactDOM.preconnect("https://i.ytimg.com");
  return null;
}
