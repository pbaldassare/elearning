import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Audio/video della lezione (fase successiva: oggi nessuna lezione ha file, quindi non compare).
// I file stanno nel bucket privato "lezioni"; si può tornare indietro ma non saltare avanti.
const BUCKET = 'lezioni';

export default function Media({ lesson }: { lesson: { audio_path: string | null; video_path: string | null; captions_path: string | null } }) {
  const path = lesson.video_path ?? lesson.audio_path!;
  const [src, setSrc] = useState<{ media: string; captions?: string } | null>(null);
  const maxSeen = useRef(0);

  useEffect(() => {
    maxSeen.current = 0;
    const sign = (p: string) => supabase.storage.from(BUCKET).createSignedUrl(p, 3600).then(({ data }) => data?.signedUrl);
    Promise.all([sign(path), lesson.captions_path ? sign(lesson.captions_path) : undefined])
      .then(([media, captions]) => media && setSrc({ media, captions }));
  }, [path, lesson.captions_path]);

  if (!src) return null;
  const Tag = lesson.video_path ? 'video' : 'audio';
  return (
    <Tag
      src={src.media}
      controls
      controlsList="nodownload noplaybackrate"
      className="mb-4 w-full rounded-2xl bg-black"
      onTimeUpdate={(e) => { maxSeen.current = Math.max(maxSeen.current, e.currentTarget.currentTime); }}
      onSeeking={(e) => { if (e.currentTarget.currentTime > maxSeen.current + 1) e.currentTarget.currentTime = maxSeen.current; }}
    >
      {src.captions && <track kind="captions" src={src.captions} srcLang="it" label="Italiano" default />}
    </Tag>
  );
}
