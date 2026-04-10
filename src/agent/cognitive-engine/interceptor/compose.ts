import type { ToolInterceptor } from '../types';

/**
 * 将多个 ToolInterceptor 组合为单个 pipeline interceptor
 * 前一个拦截器的输出作为后一个的输入
 *
 * @param interceptors - 拦截器数组，按顺序依次应用
 * @returns 组合后的单个拦截器；空数组时返回恒等函数
 */
export function composeInterceptors(interceptors: ToolInterceptor[]): ToolInterceptor {
  if (interceptors.length === 0) {
    return (_toolName, toolArgs) => toolArgs;
  }
  return (toolName, toolArgs) =>
    interceptors.reduce((args, interceptor) => interceptor(toolName, args), toolArgs);
}
