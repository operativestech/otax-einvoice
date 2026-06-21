import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

const SECRET_PLACEHOLDER = '••••••••';

interface SecretInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    /** Async fetcher that returns the cleartext currently stored on the server,
     *  or null if no secret is stored / caller is not authorized. Called when the
     *  user clicks the eye and the field still shows the bullet sentinel. */
    onReveal?: () => Promise<string | null>;
    wrapperClassName?: string;
}

/**
 * Drop-in replacement for <input type="password" /> that:
 *  1. Toggles password ↔ text visibility via an eye icon.
 *  2. When the field still shows the bullet sentinel ("••••••••"), clicking the
 *     eye fetches the actual stored cleartext from the server (via onReveal) so
 *     the user can verify what was persisted instead of just what they typed.
 *
 * Stays uncontrolled by default (compatible with the existing form-collection
 * approach in Settings.tsx that uses document.querySelectorAll on save).
 */
const SecretInput: React.FC<SecretInputProps> = ({
    onReveal,
    wrapperClassName,
    className,
    defaultValue,
    ...rest
}) => {
    const [show, setShow] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-clear the inline error after a few seconds
    useEffect(() => {
        if (!errMsg) return;
        const t = setTimeout(() => setErrMsg(null), 3500);
        return () => clearTimeout(t);
    }, [errMsg]);

    const handleEye = async () => {
        const el = inputRef.current;
        if (!el) return;
        const current = el.value;

        // If the field still shows the bullet sentinel and we have a reveal hook,
        // fetch the stored cleartext from the server. Otherwise just toggle type.
        if (!show && current === SECRET_PLACEHOLDER && onReveal) {
            setRevealing(true);
            setErrMsg(null);
            try {
                const value = await onReveal();
                if (value === null) {
                    setErrMsg('Could not reveal — check permissions');
                } else if (value === '') {
                    setErrMsg('No value stored on the server');
                    setShow(true);
                } else {
                    el.value = value;
                    setShow(true);
                }
            } catch (e: any) {
                setErrMsg(e?.message || 'Reveal failed');
            } finally {
                setRevealing(false);
            }
            return;
        }
        setShow(s => !s);
    };

    return (
        <div className={`relative ${wrapperClassName || ''}`}>
            <input
                ref={inputRef}
                {...rest}
                type={show ? 'text' : 'password'}
                defaultValue={defaultValue}
                className={`${className || ''} pr-10`}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={handleEye}
                disabled={revealing}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                title={show ? 'Hide' : 'Show'}
            >
                {revealing ? <Loader2 size={16} className="animate-spin" />
                    : show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {errMsg && (
                <div className="absolute left-0 -bottom-5 text-[10px] text-rose-600 font-medium">
                    {errMsg}
                </div>
            )}
        </div>
    );
};

export default SecretInput;
