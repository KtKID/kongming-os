/**
 * 侧栏 MadeMe 入口图标；按钮、标签与选中态均由侧栏 shell 拥有
 * （SidebarRoot 的 PanelRow），本组件只按请求尺寸渲染字形。
 */
import type { ReactNode } from "react";
import { IconSparkleRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";

/**
 * 按侧栏请求的边长渲染 MadeMe 图标。
 * @param props - 侧栏图标份额：请求的像素边长与面板选中态。
 * @returns 图标元素。
 */
export function MadeMeIcon({
  size,
}: PropsRuntime<"sidebar.panellist">): ReactNode {
  return <IconSparkleRegular size={size} />;
}
