import { unwrap, type Schemas } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';

export type Party = Schemas['Party'];
export type EntityPath =
  | 'parties'
  | 'parliamentary-groups'
  | 'electoral-districts'
  | 'electoral-terms'
  | 'governments'
  | 'bodies'
  | 'position-types';
type Row = { id: string; deletedAt: string | null; source: string; manualFields: string[] } & Record<
  string,
  unknown
>;

/** Generic list/create/update/delete hooks for registry entities over the typed SDK. */
export function useEntityList<T = Row>(entity: EntityPath) {
  const api = useApi();
  return useQuery({
    queryKey: ['registries', entity],
    queryFn: async () =>
      (
        await unwrap(
          api.GET(`/registries/${entity}` as '/registries/parties', { params: { query: { limit: 1000 } } }),
        )
      ).items as unknown as T[],
  });
}

export function useEntity<T = Row>(entity: EntityPath, id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['registries', entity, id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await unwrap(
        api.GET(`/registries/${entity}/{id}` as '/registries/parties/{id}', {
          params: { path: { id: id! } },
        }),
      )) as unknown as T,
  });
}

export function useEntityMutations(entity: EntityPath) {
  const api = useApi();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['registries'] });
  return {
    update: useMutation({
      mutationFn: (p: { id: string; patch: Record<string, unknown> }) =>
        unwrap(
          api.PATCH(`/registries/${entity}/{id}` as '/registries/parties/{id}', {
            params: { path: { id: p.id } },
            body: p.patch as never,
          }),
        ),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        unwrap(api.POST(`/registries/${entity}` as '/registries/parties', { body: body as never })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        unwrap(
          api.DELETE(`/registries/${entity}/{id}` as '/registries/parties/{id}', {
            params: { path: { id } },
          }),
        ),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (id: string) =>
        unwrap(
          api.POST(`/registries/${entity}/{id}/restore` as '/registries/parties/{id}/restore', {
            params: { path: { id } },
          }),
        ),
      onSuccess: invalidate,
    }),
  };
}
