/**
 * 侧栏"Token 分析"入口图标；按钮、标签与选中态均由侧栏 shell 拥有
 * （SidebarRoot 的 PanelRow），本组件只按请求尺寸渲染字形。
 * 图标取自 ui-primitives 现有图标库：库内无图表类字形，Data 的数据语义
 * 与"多渠道 token 用量与分布"最贴近；Outline 线性变体与 Infra 的仪表盘
 * 图标及侧栏其余条目风格一致。
 */
import type { ReactNode } from "react";
import { IconDataOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";

/**
 * 按侧栏请求的边长渲染 Token 分析图标。
 * @param props - 侧栏图标份额：请求的像素边长与面板选中态。
 * @returns 图标元素。
 */
export function TokenAnalysisIcon({
  size,
}: PropsRuntime<"sidebar.panellist">): ReactNode {
  return <IconDataOutlineRegular size={size} />;
}
