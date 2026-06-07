import { useEffect, useState } from 'react';
import { request } from '../lib/api'; // note: use request or your project's fetch equivalent

export function SharedLinksPage() {
  const [links, setLinks] = useState<any[]>([]);

  useEffect(() => {
    request('/api/shared').then((res: any) => setLinks(res.links));
  }, []);

  const revoke = async (id: string) => {
    await request(`/api/shared/${id}`, { method: 'DELETE' });
    setLinks(links.filter(l => l.id !== id));
  };

  return (
    <div className="p-4">
      <h2>Active Shared Links</h2>
      <ul>
        {links.map(link => (
          <li key={link.id}>
            {link.id} - Views: {link.viewCount} - Downloads: {link.downloadCount}
            <button onClick={() => revoke(link.id)}>Stop Sharing</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
