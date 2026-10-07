/** 详情页与 Host 共享的账号状态类型（浏览器侧安全，不含凭据值）。 */
export interface AccountStatus {
  login: "signed-in" | "idle" | "starting" | "waiting" | "failed";
  /** 凭据来源说明（路径级，不含内容）。 */
  credentialSource?: string;
  /** 进行中登录的授权链接。 */
  authorizeUrl?: string;
  error?: string;
}
