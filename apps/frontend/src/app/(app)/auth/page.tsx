import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
export const dynamic = 'force-dynamic';
import { Register } from '@gitroom/frontend/components/auth/register';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { redirect } from 'next/navigation';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Datafly Social' : 'Gitroom'} Login`,
  description: '',
};
export default async function Auth(params: {searchParams: Promise<{provider: string; code: string}>}) {
  const searchParams = await params?.searchParams;
  // An OAuth callback carries provider/code and must reach <Register /> to
  // complete the exchange. Any other visit goes straight to the login screen
  // when registration is disabled (invite-only deployment).
  const isOauthCallback = !!searchParams?.provider || !!searchParams?.code;
  if (process.env.DISABLE_REGISTRATION === 'true' && !isOauthCallback) {
    const canRegister = (
      await (await internalFetch('/auth/can-register')).json()
    ).register;
    if (!canRegister) {
      redirect('/auth/login');
    }
  }
  return <Register />;
}
