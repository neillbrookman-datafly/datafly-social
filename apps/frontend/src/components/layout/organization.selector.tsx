'use client';

import React, { FC, useCallback, useMemo } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import clsx from 'clsx';

const OrgAvatar: FC<{ name?: string }> = ({ name }) => (
  <div className="w-[20px] h-[20px] min-w-[20px] rounded-[6px] bg-btnPrimary text-white text-[11px] font-[600] flex items-center justify-center uppercase">
    {(name || '?').trim().charAt(0)}
  </div>
);

export const OrganizationSelector: FC<{ asOpenSelect?: boolean }> = ({
  asOpenSelect,
}) => {
  const fetch = useFetch();
  const user = useUser();
  const load = useCallback(async () => {
    return await (await fetch('/user/organizations')).json();
  }, []);
  const { isLoading, data } = useSWR('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
  const current = useMemo(() => {
    return data?.find((d: any) => d.id === user?.orgId);
  }, [data, user]);
  const changeOrg = useCallback(
    (org: { name: string; id: string }) => async () => {
      if (org.id === user?.orgId) {
        return;
      }
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({
          id: org.id,
        }),
      });
      window.location.reload();
    },
    [user]
  );
  if (isLoading || !data?.length) {
    return null;
  }
  const multiple = data.length > 1;
  return (
    <>
      <div className="hover:text-newTextColor">
        <div className="group text-[12px] relative">
          {asOpenSelect && (
            <div className="bg-btnPrimary !flex !relative max-w-[500px] mx-auto py-[12px] px-[12px]">
              Select Organization
            </div>
          )}
          {!asOpenSelect && (
            <div
              className={clsx(
                'flex items-center gap-[8px] select-none',
                multiple && 'cursor-pointer'
              )}
              title={current?.name}
            >
              <OrgAvatar name={current?.name} />
              <span className="max-w-[140px] truncate whitespace-nowrap">
                {current?.name}
              </span>
              {multiple && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1 3.5L5 7.5L9 3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          )}
          {(multiple || asOpenSelect) && (
            <div
              className={clsx(
                'hidden group-hover:flex absolute top-[100%] end-0 z-[200] min-w-[220px] flex-col rounded-[8px] border border-tableBorder bg-third py-[6px] shadow-menu',
                asOpenSelect
                  ? '!flex !relative max-w-[500px] mx-auto mb-[10px]'
                  : ''
              )}
            >
              {data?.map((org: { name: string; id: string }) => {
                const isCurrent = org.id === user?.orgId;
                return (
                  <div
                    key={org.id}
                    onClick={changeOrg(org)}
                    className={clsx(
                      'flex items-center gap-[10px] px-[12px] py-[8px] whitespace-nowrap',
                      isCurrent
                        ? 'text-newTextColor'
                        : 'cursor-pointer hover:bg-blockSeparator'
                    )}
                  >
                    <OrgAvatar name={org.name} />
                    <span className="flex-1 truncate max-w-[240px]">
                      {org.name}
                    </span>
                    {isCurrent && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 6.5L4.5 9L10 3.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {!asOpenSelect && <div className="w-[1px] h-[20px] bg-blockSeparator" />}
    </>
  );
};
