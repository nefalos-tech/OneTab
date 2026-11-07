import { loadCreate } from "@/client/checkout-source";
import { CreateScreen } from "@/components/create-screen";

export default async function CreatePage(props: PageProps<"/">) {
  return <CreateScreen state={await loadCreate(props)} />;
}
