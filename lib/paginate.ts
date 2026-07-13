export const PAGE_SIZE = 50

export function paginationSlice<T>(
  items: T[],
  loaded: number,
): { visible: T[]; hasMore: boolean } {
  return {
    visible: items.slice(0, loaded),
    hasMore: items.length > loaded,
  }
}
