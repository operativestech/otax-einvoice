import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    /** Extra class name for the wrapper div */
    wrapperClassName?: string;
}

/**
 * Password input with an eye icon to toggle visibility.
 * Drop-in replacement for <input type="password" />.
 */
const PasswordInput: React.FC<PasswordInputProps> = ({ wrapperClassName, className, ...props }) => {
    const [show, setShow] = useState(false);

    return (
        <div className={`relative ${wrapperClassName || ''}`}>
            <input
                {...props}
                type={show ? 'text' : 'password'}
                className={`${className || ''} pr-10`}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    );
};

export default PasswordInput;
