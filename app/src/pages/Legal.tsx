import { useParams, Navigate } from "react-router-dom";
import { DocLayout } from "../components/DocKit";
import { LEGAL } from "./legal/content";
import { SITE } from "../site";

export default function Legal() {
  const { slug } = useParams();
  if (!slug || !LEGAL.some((d) => d.slug === slug)) return <Navigate to={`/legal/${LEGAL[0].slug}`} replace />;
  return <DocLayout base="/legal" eyebrow="Legal" pages={LEGAL} slug={slug} meta={<div className="mt-3 text-sm text-faint">Last updated {SITE.legalUpdated}</div>} />;
}
