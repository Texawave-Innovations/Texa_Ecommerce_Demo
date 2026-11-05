'use client';
import { useSession } from '@/lib/stores';
import { VendorPortal } from '@/components/scm/vendor';
import { EmptyState, Card } from '@texafashions/ui';

export default function VendorPage() {
  const role = useSession((s) => s.session!.claims.role);
  if (role !== 'vendor' && role !== 'super_admin') return <Card><EmptyState kind="bear" title="Vendor portal" hint="This area is for vendor accounts. Sign in as the Vendor demo user." /></Card>;
  return <VendorPortal />;
}
