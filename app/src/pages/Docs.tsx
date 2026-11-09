import { useParams, Navigate } from "react-router-dom";
import { DocLayout } from "../components/DocKit";
import { DOCS } from "./docs/content";

export default function Docs() {
  const { slug } = useParams();
  if (!slug || !DOCS.some((d) => d.slug === slug)) return <Navigate to={`/docs/${DOCS[0].slug}`} replace />;
  return <DocLayout base="/docs" eyebrow="Docs" pages={DOCS} slug={slug} />;
}
