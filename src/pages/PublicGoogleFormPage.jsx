import Brand from '../components/Brand.jsx'

const googleFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfJ5NDal89SNvzA7UkR9_0q9ZBjsd2fxRYZkoLhC7L6IhMTsg/viewform?embedded=true'

export default function PublicGoogleFormPage() {
  return <main className="google-form-page">
    <header className="google-form-header"><Brand /><p>Preencha seus dados para concluir o cadastro.</p></header>
    <iframe title="Formulário de cadastro de cliente" src={googleFormUrl} className="google-form-frame" loading="lazy" />
  </main>
}
