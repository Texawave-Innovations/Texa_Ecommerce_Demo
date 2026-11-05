'use client';
import { useParams } from 'next/navigation';
import { EmployeeDetail } from '@/components/hr/employees';
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <EmployeeDetail id={id} />;
}
