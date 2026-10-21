"use client";

import { AdminContact, useInfo } from "@/components/help-note";

export function Contact({ withChannel = false }: { withChannel?: boolean }) {
  const info = useInfo();
  return (
    <span data-testid="admin-contact">
      <AdminContact info={info} />
      {withChannel && info && ` via e-mail or ping on ${info.admin_communication}`}
    </span>
  );
}

const FALLBACK = {
  code_url: "https://github.com/jschaef/sarfile_analyzer_ng",
  web_code_url: "https://github.com/jschaef/sarfile_analyzer_web",
};

export function CodeLinks() {
  const links = useInfo() ?? FALLBACK;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        Parser, Streamlit app and API:{" "}
        <a className="underline underline-offset-2" href={links.code_url} target="_blank" rel="noreferrer">
          {links.code_url}
        </a>
      </li>
      <li>
        This web frontend:{" "}
        <a className="underline underline-offset-2" href={links.web_code_url} target="_blank" rel="noreferrer">
          {links.web_code_url}
        </a>
      </li>
    </ul>
  );
}
