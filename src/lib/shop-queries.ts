import { queryOptions } from "@tanstack/react-query";

import {
  getBackendMode,
  getDesignDetail,
  getOrderStatus,
  getSiteContent,
  listCategories,
  listDesigns,
} from "./shop.functions";

export const backendModeQuery = queryOptions({
  queryKey: ["backend-mode"],
  queryFn: () => getBackendMode(),
  staleTime: 60_000,
});

export const designsQuery = queryOptions({
  queryKey: ["designs"],
  queryFn: () => listDesigns(),
  staleTime: 60_000,
});

export const designDetailQuery = (designId: string) =>
  queryOptions({
    queryKey: ["design", designId],
    queryFn: () => getDesignDetail({ data: { designId } }),
    staleTime: 60_000,
  });

export const orderQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["order", orderId],
    queryFn: () => getOrderStatus({ data: { orderId } }),
  });

export const formatKsh = (n: number) => "KSh " + n.toLocaleString("en-KE");

export const categoriesQuery = queryOptions({
  queryKey: ["categories"],
  queryFn: () => listCategories(),
  staleTime: 60_000,
});

export const siteContentQuery = queryOptions({
  queryKey: ["site-content"],
  queryFn: () => getSiteContent(),
  staleTime: 60_000,
});
