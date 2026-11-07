import { loadCreate } from "@/client/checkout-source";
import { Viewer } from "@/components/viewer";

export default async function CreatePage(props: PageProps<"/">) {
  return <Viewer screen="create" state={await loadCreate(props)} />;
}
