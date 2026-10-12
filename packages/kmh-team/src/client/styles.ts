/** 使用宿主排版、颜色与通用控件的布局值。 */
import type { CSSProperties } from "react";
export const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
export const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};
export const field: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--dsw-alias-border-l1)",
  borderRadius: 8,
  background: "var(--dsw-alias-bg-base)",
  color: "inherit",
  font: "inherit",
  boxSizing: "border-box",
};
export const box: CSSProperties = {
  ...stack,
  flex: 1,
  padding: 12,
  border: "1px solid var(--dsw-alias-border-l1)",
  borderRadius: 10,
  minHeight: 150,
};
export const badge: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 34,
  height: 34,
  borderRadius: 12,
  background: "var(--dsw-specific-bubble)",
  color: "var(--dsw-alias-label-primary)",
  fontWeight: 600,
};
