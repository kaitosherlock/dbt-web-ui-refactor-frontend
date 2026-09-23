export interface MacroArgument {
    name: string;
    type?: string;
    description?: string;
}

export interface DbtMacro {
    id: string;
    name: string;
    package_name?: string | null;
    unique_id: string;
    path: string;
    description?: string | null;
    arguments: MacroArgument[];
}
