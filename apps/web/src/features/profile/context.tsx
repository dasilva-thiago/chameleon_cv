import type { ProfileDocument, ProfileSummary } from '@chameleon/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildIndex, type ProfileIndex } from './document';

export interface ProfileData {
  /** `null` enquanto o perfil nao existe (nada foi salvo). */
  document: ProfileDocument | null;
  index: ProfileIndex;
  summary: ProfileSummary;
  exists: boolean;
}

const ProfileDataContext = createContext<ProfileData | null>(null);

export function ProfileDataProvider({
  document,
  summary,
  exists,
  children,
}: {
  document: ProfileDocument | null;
  summary: ProfileSummary;
  exists: boolean;
  children: ReactNode;
}) {
  const value = useMemo<ProfileData>(
    () => ({ document, summary, exists, index: buildIndex(document) }),
    [document, summary, exists],
  );
  return <ProfileDataContext.Provider value={value}>{children}</ProfileDataContext.Provider>;
}

export function useProfileData(): ProfileData {
  const value = useContext(ProfileDataContext);
  if (value === null) throw new Error('useProfileData fora do ProfileDataProvider');
  return value;
}
